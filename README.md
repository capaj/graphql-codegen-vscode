# graphql-codegen-vscode

Generates @graphql-codegen as soon as you hit save on any `gql` or `graphql` file.
Keep in mind it will only run when your node_modules contain `@graphql-codegen/cli` package.

### How is it different than VilvaAthibanPB.graphql-codegen

This extension uses codegen from your node_moodules inside the folder you are working on, so you will never get a mismatching output to what your CLI would give you. Also it is faster. VilvaAthibanPB's always executes all of the codegens.
This extensions only executes codegens that match the last saved file.

### Contributing

Test are done manually for now.
