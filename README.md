# graphql-codegen-vscode

Runs [@graphql-codegen](https://github.com/dotansimha/graphql-code-generator) generation as soon as you hit save on any `gql` or `graphql` file.
Keep in mind it will only run when your node_modules contains `@graphql-codegen/cli` package.

### How is it different than VilvaAthibanPB.graphql-codegen

This extension uses codegen from your node_moodules inside the folder you are working on, so you will never get a mismatching output to what your CLI would give you. Also it is faster. VilvaAthibanPB's always executes all of the codegens.
This extensions only executes codegens that match the last saved file.

### OS support

Tested on Windows and Linux for now.

### Contributing

Testing is done manually until some basic specs are added.

## CLI Version support

Extension is tested with @graphql-codegen/cli version 1.21.x.
Other versions might not work as expected. If you hit any problems with other versions, please report them. The aim is to support as broad range of CLI versions as possible.

## FAQ

### Command output
Since this runs the codegen behind the scenes you cannot see the output. You get notified of success/error with a vscode information message like this:

![image](https://user-images.githubusercontent.com/1305378/127301219-830602e3-b77b-4723-a69a-45e73121c334.png)
