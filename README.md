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
Other versions might not work as expected. If you see any
