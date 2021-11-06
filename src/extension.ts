import * as vscode from 'vscode'
import * as graphqlCodegenCli from '@graphql-codegen/cli'

import * as path from 'path'
import multimatch from 'multimatch'
import cloneDeep from 'lodash.clonedeep'
import { YamlCliFlags } from '@graphql-codegen/cli'

/**
 * Current workspace directory
 */
export const firstWorkspaceDirectory = () =>
  vscode.workspace.workspaceFolders![0].uri.fsPath

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
      const flags: Partial<graphqlCodegenCli.YamlCliFlags> = {
        config: path.join(firstWorkspaceDirectory(), 'codegen.yml'),
      }
      cachedCtx = await cli.createContext(flags as YamlCliFlags)

      cachedCtx.cwd = firstWorkspaceDirectory()
      // @ts-expect-error
      const { config } = cachedCtx
      if (config.schema) {
        // typically on a config for a single codegen artefact0
        config.schema = makePathAbsoluteInSchema(config.schema)
      }

      const generates = config.generates
      if (generates) {
        originalGenerates = cloneDeep(generates)
        const generatesWithAllAbsolutePaths = {}
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
            codegenGenerate.preset.includes('near-operation-file') &&
            !codegenGenerate.presetConfig.cwd
          ) {
            codegenGenerate.presetConfig.cwd = firstWorkspaceDirectory()
          }
          codegenGenerate.originalOutputPath = codegenGenerateOutput
          // @ts-expect-error
          generatesWithAllAbsolutePaths[
            makePathAbsolute(codegenGenerateOutput) // this is only needed for windows. Not sure why, but it works fine on linux even when these paths are relative
          ] = codegenGenerate
        }
        config.generates = generatesWithAllAbsolutePaths
      }
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
        // @ts-expect-error
        const generates = ctx.config.generates
        // @ts-expect-error
        if (ctx.config.schema) {
          // @ts-expect-error
          ctx.config.documents = document.fileName
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
      // @ts-expect-error
      ctx.config.documents = makePathOrPathArrayAbsolute(
        // @ts-expect-error
        cachedCtx?.config.documents
      )
      //@ts-expect-error
      await runCliGenerateWithUINotifications(ctx, ctx.config.documents)
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
    vscode.window.showErrorMessage(
      `Codegen threw ${err.errors.length} ${
        err.errors.length === 1 ? 'error' : 'errors'
      }, first one: ${err.errors[0].message}`
    )
  }
}

export function deactivate() {
  cli = null
}
