// taken from https://github.com/dotansimha/graphql-code-generator/blob/0d587da37db340da0a98c40b97f3292a1a4daee5/packages/graphql-codegen-cli/src/config.ts#L23
export function generateSearchPlaces(moduleName: string) {
  const extensions = ['json', 'yaml', 'yml', 'js', 'config.js']
  // gives codegen.json...
  const regular = extensions.map((ext) => `${moduleName}.${ext}`)
  // gives .codegenrc.json... but no .codegenrc.config.js
  const dot = extensions
    .filter((ext) => ext !== 'config.js')
    .map((ext) => `.${moduleName}rc.${ext}`)

  return [...regular.concat(dot), 'package.json']
}
