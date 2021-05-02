import * as vscode from 'vscode'
import * as graphqlCodegenCli from '@graphql-codegen/cli'

import * as yaml from 'js-yaml'

import * as fs from 'fs'
import * as path from 'path'
import { YamlCliFlags } from '@graphql-codegen/cli'
/**
 * Current workspace directory
 */

export const currentDirectory = () =>
  vscode.workspace.workspaceFolders![0].uri.fsPath

const makePathsAbsolute = (fsPath: string | string[]): any => {
  if (Array.isArray(fsPath)) {
    return fsPath.map(makePathsAbsolute)
  }
  if (path.isAbsolute(fsPath)) {
    return fsPath
  }
  return path.join(currentDirectory(), fsPath)
}

/**
 * Create config JSON from input config
 */

// export const createContext = () => {
//   const configFilePath = currentDirectory() + '/codegen.yml'
//   const configFileContents = fs.readFileSync(configFilePath, 'utf8')

//   // @ts-expect-error
//   let context = new CodegenContext({ config: yaml.load(configFileContents) })
//   //
//   // config = modifyOutputFilePath(config);
//   // config = modifySchemaAndDocumentsPath(config);
//   context.cwd = currentDirectory()
//   console.log(context.getConfig())
//   const originalGetConfig = context.getConfig
//   // @ts-expect-error
//   context.getConfig = () => {
//     const conf = originalGetConfig()
//     conf.pluginLoader = makePluginLoader as any
//     return conf
//   }
//   return context as CodegenContext
// }

export function activate(context: vscode.ExtensionContext) {
  let cli: typeof graphqlCodegenCli

  try {
    cli = require(path.join(
      currentDirectory(),
      '/node_modules/@graphql-codegen/cli'
    ))
  } catch (err) {
    // ignore-we only want to run if @graphql-codegen/cli is installed in node modules
  }

  let cachedCtx: graphqlCodegenCli.CodegenContext | null = null

  const getCodegenContextForVSCode = async (fileName?: string) => {
    if (cachedCtx) {
      return cachedCtx
    }
    console.log('~ currentDirectory()', currentDirectory())

    try {
      const flags: Partial<graphqlCodegenCli.YamlCliFlags> = {
        config: path.join(currentDirectory(), 'codegen.yml'),
      }
      cachedCtx = await cli.createContext(flags as YamlCliFlags)
      console.log('cached ctx', cachedCtx)

      cachedCtx.cwd = currentDirectory()
      // @ts-expect-error
      cachedCtx.config.schema = makePathsAbsolute(cachedCtx.config.schema)

      return cachedCtx
    } catch (err) {
      console.error(err)
      throw err
    }
  }

  vscode.workspace.onDidSaveTextDocument(
    async (document: vscode.TextDocument) => {
      console.log('document.fileName', document.fileName)

      if (
        (cli && document.fileName.endsWith('graphql')) ||
        document.fileName.endsWith('gql')
      ) {
        const ctx = await getCodegenContextForVSCode(document.fileName)
        // @ts-expect-error
        ctx.config.documents = document.fileName
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
