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

const makePathsAbsolute = (fsPath: string | string[]): any => {
  if (Array.isArray(fsPath)) {
    return fsPath.map(makePathsAbsolute)
  }
  if (path.isAbsolute(fsPath)) {
    return fsPath
  }
  return path.join(firstWorkspaceDirectory(), fsPath)
}

export function activate(context: vscode.ExtensionContext) {
  let cli: typeof graphqlCodegenCli

  try {
    cli = require(path.join(
      firstWorkspaceDirectory(),
      '/node_modules/@graphql-codegen/cli'
    ))
  } catch (err) {
    // ignore-we only want to run if @graphql-codegen/cli is installed in node modules
  }

  let cachedCtx: graphqlCodegenCli.CodegenContext | null = null
  let originalGenerates: object | null = null

  const getCodegenContextForVSCode = async (fileName?: string) => {
    if (cachedCtx) {
      return cachedCtx
    }

    try {
      const flags: Partial<graphqlCodegenCli.YamlCliFlags> = {
        config: path.join(firstWorkspaceDirectory(), 'codegen.yml'),
      }
      cachedCtx = await cli.createContext(flags as YamlCliFlags)
      // console.log('cached ctx', cachedCtx)

      cachedCtx.cwd = firstWorkspaceDirectory()
      // @ts-expect-error
      const { config } = cachedCtx
      if (config.schema) {
        // typically on a config for a single codegen artefact0
        // @ts-expect-error
        config.schema = makePathsAbsolute(cachedCtx.config.schema)
      }

      const generates = config.generates
      if (generates && !config.schema) {
        originalGenerates = cloneDeep(generates)

        // typically on a config for a codegen with multiple artifacts
        for (const codegenGenerateOutput of Object.keys(generates)) {
          const codegenGenerate = generates[codegenGenerateOutput]

          codegenGenerate.schema = makePathsAbsolute(codegenGenerate.schema)
          if (
            codegenGenerate.preset &&
            codegenGenerate.preset.includes('near-operation-file') &&
            !codegenGenerate.presetConfig.cwd
          ) {
            codegenGenerate.presetConfig.cwd = firstWorkspaceDirectory()
          }
        }
      }
      return cachedCtx
    } catch (err) {
      console.error(err)
      throw err
    }
  }

  vscode.workspace.onDidSaveTextDocument(
    async (document: vscode.TextDocument) => {
      // console.log('document.fileName', document.fileName)

      if (
        (cli && document.fileName.endsWith('graphql')) ||
        document.fileName.endsWith('gql')
      ) {
        const ctx = await getCodegenContextForVSCode(document.fileName)

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
              originalGenerates[codegenGenerateOutput].documents
            )

            if (matches.length === 0) {
              // this file does not match the glob. This will not generate so we can omit this
              codegenGenerate.documents = []
            } else {
              codegenGenerate.documents = document.fileName
            }
          }
        }

        await cli.generate(ctx)
        vscode.window.showInformationMessage(
          `codegen ${document.fileName} done!`
        )
      }
      // const customConfig = customExtensionConfig()
    }
  )

  let disposable = vscode.commands.registerCommand(
    'graphql-codegen.generateGqlCodegen',
    async () => {
      if (!cli) {
        return
      }
      const ctx = await getCodegenContextForVSCode()
      // @ts-expect-error
      ctx.config.documents = makePathsAbsolute(cachedCtx.config.documents)
      await cli.generate(ctx)

      vscode.window.showInformationMessage(
        // @ts-expect-error
        `codegen ${ctx.config.documents} done!`
      )
    }
  )
  context.subscriptions.push(disposable)
}

export function deactivate() {}

const makePluginLoader = (from: string) => {
  console.log('~ from', from)

  return (mod: string) => {
    return {}
  }
}
