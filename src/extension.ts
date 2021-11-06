import * as vscode from 'vscode'
import * as graphqlCodegenCli from '@graphql-codegen/cli'

import * as path from 'path'
import multimatch from 'multimatch'
import cloneDeep from 'lodash.clonedeep'
import { YamlCliFlags } from '@graphql-codegen/cli'
import { generateSearchPlaces } from './generateSearchPlaces'
import globby from 'globby'

/**
 * Current workspace directory
 */
export const firstWorkspaceDirectory = () => {
  return (
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    vscode.workspace.workspaceFolders![0].uri.fsPath
  )
}

const makePathAbsolute = (fsPath: string): string => {
  if (path.isAbsolute(fsPath) || fsPath.startsWith('http')) {
    return fsPath
  }
  return path.join(firstWorkspaceDirectory(), fsPath)
}

const makePathAbsoluteInSchema = (
  schema: string | Record<string, any> | (string | Record<string, any>)[]
): string | Record<string, any> | (string | Record<string, any>)[] => {
  if (Array.isArray(schema)) {
    return schema.map(makePathAbsoluteInSchema)
  }

  if (typeof schema === 'string') {
    return makePathAbsolute(schema)
  }

  const [path, configuration] = Object.entries(schema)[0]
  return { [makePathAbsolute(path)]: configuration }
}

const PLUGIN_SETTINGS_ID = 'graphql-codegen'
const FILE_EXTENSIONS_WITH_DOCUMENTS_KEY =
  'fileExtensionsDeclaringGraphQLDocuments'
const FILE_PATH_TO_WATCH_KEY = 'filePathToWatch'
const CONFIG_FILE_PATH = 'configFilePath'

function shouldRunGQLCodegenOnFile(filePath: string): boolean {
  const configuration = vscode.workspace.getConfiguration(PLUGIN_SETTINGS_ID)

  const fileExtensionsContainingGraphQLDocuments = configuration.get<string[]>(
    FILE_EXTENSIONS_WITH_DOCUMENTS_KEY,
    ['graphql', 'gql']
  )
  const filePathToWatch = configuration.get<string | null>(
    FILE_PATH_TO_WATCH_KEY,
    null
  )

  const fileMatchesExtensions = fileExtensionsContainingGraphQLDocuments.some(
    (ext) => filePath.endsWith(ext)
  )
  const fileInPathToWatch =
    filePathToWatch == null || multimatch(filePath, filePathToWatch).length > 0

  return fileMatchesExtensions && fileInPathToWatch
}

let cli: typeof graphqlCodegenCli | null = null

function getGQLCodegenCli() {
  if (cli) {
    return cli
  }
  try {
    cli = require(path.join(
      firstWorkspaceDirectory(),
      '/node_modules/@graphql-codegen/cli'
    ))
  } catch (err) {
    // ignore-we only want to run if @graphql-codegen/cli is installed in node modules
  }
}

const getConfigPath = async () => {
  const configuration = vscode.workspace.getConfiguration(PLUGIN_SETTINGS_ID)
  const userConfigPath = configuration.get<string | undefined>(
    CONFIG_FILE_PATH,
    undefined
  )

  if (userConfigPath) {
    return makePathAbsolute(userConfigPath)
  }

  const foundConfigs = await globby(generateSearchPlaces('codegen'), {
    cwd: firstWorkspaceDirectory()
  })

  return path.join(firstWorkspaceDirectory(), foundConfigs[0])
}

export function activate(context: vscode.ExtensionContext) {
  let cachedCtx: graphqlCodegenCli.CodegenContext | null = null
  let originalGenerates: Record<string, unknown> | null = null

  const getCodegenContextForVSCode = async () => {
    if (cachedCtx) {
      return cachedCtx
    }

    if (!cli) {
      vscode.window.showWarningMessage(
        `could not find '/node_modules/@graphql-codegen/cli'`
      )
      return
    }

    try {
      const configFilePath = await getConfigPath()

      const flags: Partial<graphqlCodegenCli.YamlCliFlags> = {
        config: configFilePath
      }
      cachedCtx = await cli.createContext(flags as YamlCliFlags)

      cachedCtx.cwd = firstWorkspaceDirectory()

      const config = cachedCtx.getConfig()
      if (config.schema) {
        // typically on a config for a single codegen artefact0
        config.schema = makePathAbsoluteInSchema(config.schema)
      }

      const generates = config.generates
      if (generates) {
        originalGenerates = cloneDeep(generates)
        const generatesWithAllAbsolutePaths: Record<string, any> = {}
        // typically on a config for a codegen with multiple artifacts
        for (const codegenGenerateOutput of Object.keys(generates)) {
          const codegenGenerate = generates[codegenGenerateOutput]

          if (codegenGenerate.schema) {
            codegenGenerate.schema = makePathAbsoluteInSchema(
              codegenGenerate.schema
            )
          }
          if (
            codegenGenerate.preset &&
            typeof codegenGenerate.preset === 'string' &&
            codegenGenerate.preset.includes('near-operation-file') &&
            !codegenGenerate.presetConfig?.cwd
          ) {
            if (!codegenGenerate.presetConfig) {
              codegenGenerate.presetConfig = {}
            }
            codegenGenerate.presetConfig.cwd = firstWorkspaceDirectory()
          }
          // @ts-expect-error
          codegenGenerate.originalOutputPath = codegenGenerateOutput
          generatesWithAllAbsolutePaths[
            makePathAbsolute(codegenGenerateOutput) // this is only needed for windows. Not sure why, but it works fine on linux even when these paths are relative
          ] = codegenGenerate
        }
        config.generates = generatesWithAllAbsolutePaths
      }

      cachedCtx.updateConfig(config)

      // console.log('cached ctx', cachedCtx)

      return cachedCtx
    } catch (err) {
      console.error(err)
      throw err
    }
  }

  vscode.workspace.onDidSaveTextDocument(
    async (document: vscode.TextDocument) => {
      if (shouldRunGQLCodegenOnFile(document.fileName)) {
        getGQLCodegenCli() // require the package lazily as late as possible-makes it possible to install the deps and get the generation working right away

        const ctx = await getCodegenContextForVSCode()
        if (!ctx) {
          return
        }

        const config = ctx.getConfig()
        const generates = config.generates
        if (config.schema) {
          config.documents = document.fileName
        } else {
          for (const codegenGenerateOutput of Object.keys(generates)) {
            const codegenGenerate = generates[codegenGenerateOutput]

            const matches = multimatch(
              document.fileName.replace(`${firstWorkspaceDirectory()}/`, ''),
              // @ts-expect-error
              originalGenerates[codegenGenerate.originalOutputPath].documents
            )

            if (matches.length === 0) {
              // this file does not match the glob. This will not generate so we can omit this
              codegenGenerate.documents = []
            } else {
              codegenGenerate.documents = document.fileName
            }
          }
        }

        ctx.updateConfig(config)

        await runCliGenerateWithUINotifications(ctx, document.fileName)
      }
      // const customConfig = customExtensionConfig()
    }
  )

  const disposable = vscode.commands.registerCommand(
    'graphql-codegen.generateGqlCodegen',
    async () => {
      getGQLCodegenCli()

      const ctx = await getCodegenContextForVSCode()
      if (!ctx) {
        return
      }

      const config = ctx.getConfig()
      // @ts-expect-error
      config.documents = makePathOrPathArrayAbsolute(config.documents)

      ctx.updateConfig(config)

      //@ts-expect-error
      await runCliGenerateWithUINotifications(ctx, config.documents)
    }
  )
  context.subscriptions.push(disposable)
}

async function runCliGenerateWithUINotifications(
  ctx: graphqlCodegenCli.CodegenContext,
  file: string
) {
  if (!cli) {
    vscode.window.showWarningMessage(
      `could not find '/node_modules/@graphql-codegen/cli'`
    )
    return
  }

  try {
    await cli.generate(ctx)

    vscode.window.showInformationMessage(`codegen ${file} done!`)
  } catch (err) {
    if (err.errors?.length) {
      vscode.window.showErrorMessage(
        `Codegen threw ${err.errors.length} ${
          err.errors.length === 1 ? 'error' : 'errors'
        }, first one: ${err.errors[0].message}`
      )
    } else {
      vscode.window.showErrorMessage(`Codegen threw error: ${err.message}`)
    }
  }
}

export function deactivate() {
  cli = null
}
