import * as vscode from 'vscode'
import * as graphqlCodegenCli from '@graphql-codegen/cli'

import * as path from 'path'
import multimatch from 'multimatch'
import cloneDeep from 'lodash.clonedeep'
import { YamlCliFlags } from '@graphql-codegen/cli'

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

const makePathOrPathArrayAbsolute = (
  fsPath: string | string[]
): string | string[] => {
  if (Array.isArray(fsPath)) {
    return fsPath.map(makePathOrPathArrayAbsolute) as string[]
  }
  return makePathAbsolute(fsPath)
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
    return cli
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

  if (cli == null) {
    return; // cli should already be loaded here
  }

  const foundConfigs = await globby(cli.generateSearchPlaces('codegen'), {
    cwd: firstWorkspaceDirectory()
  })

  return path.join(firstWorkspaceDirectory(), foundConfigs[0])
}

// TODO figure out why we're getting Activating extension 'GraphQL.vscode-graphql-execution' failed: Cannot find module 'graphql-config'
// Require stack:
// - /home/capaj/.vscode/extensions/graphql.vscode-graphql-execution-0.1.7/dist/providers/exec-content.js
// - /home/capaj/.vscode/extensions/graphql.vscode-graphql-execution-0.1.7/dist/extension.js
// it does not seem to affect anything, just annoying spam in the console, generation works fine
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
      if (!config) {
        return
      }

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
          const codegenGenerate = generates[codegenGenerateOutput] as any // as Types.ConfiguredOutput

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
        if (!config) {
          return
        }
        if (config.schema) {
          config.documents = document.fileName
        } else {
          const { generates } = config

          for (const codegenGenerateOutput of Object.keys(generates)) {
            const codegenGenerate = generates[codegenGenerateOutput] as any // as Types.ConfiguredOutput

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
      if (!config) {
        vscode.window.showWarningMessage(
          `could not find @graphql-codegen/cli config`
        )
        return
      }

      config.documents = makePathOrPathArrayAbsolute(
        config.documents as string[]
      )

      ctx.updateConfig(config)

      await runCliGenerateWithUINotifications(ctx)
    }
  )
  context.subscriptions.push(disposable)
}

async function runCliGenerateWithUINotifications(
  ctx: graphqlCodegenCli.CodegenContext,
  file?: string
) {
  if (!cli) {
    vscode.window.showWarningMessage(
      `could not find '/node_modules/@graphql-codegen/cli'`
    )
    return
  }

  try {
    await cli.generate(ctx)

    vscode.window.showInformationMessage(
      `graphql codegen ${file ?? ''} successful!`
    )
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
