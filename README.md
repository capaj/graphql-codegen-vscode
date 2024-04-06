# graphql-codegen-vscode

Runs [@graphql-codegen](https://github.com/dotansimha/graphql-code-generator) generation as soon as you hit save on any `gql` or `graphql` file.
Keep in mind it will only run when your node_modules contains `@graphql-codegen/cli` package.

## Extension config

- `"graphql-codegen.fileExtensionsDeclaringGraphQLDocuments"`: change which file extensions are watched for saves. Defaults to `graphql` and `gql`. If you just use these files to define your mutations you don't need to configure anything.
- `"graphql-codegen.filePathToWatch"`: allow users to specify a multimatch patters that file paths should match before running codegen. This is important as users could specify a more broad file (eg `ts`) that could exist in both paths relevant to graphql generation and paths that are not. Defaults to `null`, so watches everything.
- `"graphql-codegen.configFilePath"`: allow users to specify a path to the codegen configuration file. Defaults to `codegen.yml`.

### How is it different than VilvaAthibanPB.graphql-codegen

This extension uses codegen from your node_modules inside the folder you are working on, so you will never get a mismatching output to what your CLI would give you. Also it is faster-especially on large projects. VilvaAthibanPB's always executes all of the codegens.
This extensions only executes codegens that match the last saved file.

### OS support

Should support all major OSes.

### Contributing

Testing is done manually until some basic specs are added.

## CLI Version support

Extension was initially tested with @graphql-codegen/cli version 1.21.x. Last version is tested with version 5.0.0
Other versions might not work as expected. If you hit any problems with other versions, please report them. The aim is to support as broad range of CLI versions as possible.

## FAQ

### Command output

Since this runs the codegen behind the scenes you cannot see the output. You get notified of success/error with a vscode information message like this:

![image](https://user-images.githubusercontent.com/1305378/127301219-830602e3-b77b-4723-a69a-45e73121c334.png)

### Multiple workspaces support

You can have multiple workspaces in your editor, but keep in mind that we always iterate from the first to last and we run codegen inside the first workspace which has `/node_modules/@graphql-codegen/cli` module available.
If you have multiple VSCode workspaces with this module, it might not work correctly.
