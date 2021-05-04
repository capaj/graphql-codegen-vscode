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
  if (path.isAbsolute(fsPath)) {
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

let cli: typeof graphqlCodegenCli

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
  let originalGenerates: object | null = null

  const getCodegenContextForVSCode = async () => {
    if (cachedCtx) {
      return cachedCtx
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
        // @ts-expect-error
        config.schema = makePathOrPathArrayAbsolute(cachedCtx.config.schema)
      }

      const generates = config.generates
      if (generates) {
        originalGenerates = cloneDeep(generates)
        const generatesWithAllAbsolutePaths = {}
        // typically on a config for a codegen with multiple artifacts
        for (const codegenGenerateOutput of Object.keys(generates)) {
          const codegenGenerate = generates[codegenGenerateOutput]

          if (codegenGenerate.schema) {
            codegenGenerate.schema = makePathOrPathArrayAbsolute(
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
      // console.log('document.fileName', document.fileName)

      if (
        document.fileName.endsWith('graphql') ||
        document.fileName.endsWith('gql')
      ) {
        getGQLCodegenCli() // require the package lazily as late as possible-makes it possible to install the deps and get the generation working right away
        if (!cli) {
          return
        }
        const ctx = await getCodegenContextForVSCode()

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
      getGQLCodegenCli()
      if (!cli) {
        vscode.window.showWarningMessage(
          `could not find '/node_modules/@graphql-codegen/cli'`
        )
        return
      }
      const ctx = await getCodegenContextForVSCode()
      // @ts-expect-error
      ctx.config.documents = makePathOrPathArrayAbsolute(
        // @ts-expect-error
        cachedCtx?.config.documents
      )
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
