# ibsforts-plugin-babel
Runs [Babel](http://babeljs.io) on code emitted by the [Incremental Build Server for TypeScript](https://github.com/enlight/ibsforts).

## Limitations
- No support for inline source maps (though it wouldn't be that hard to do).

## Setup
```
npm install enlight/ibsforts-plugin-babel --save-dev
```

## Usage
Here's an example of plugging in the `babelTransform` function provided by this package into a
build server:
```typescript
import { IncrementalBuildServer, ProjectLoader } from 'ibsforts';
import { babelTransform } from 'ibsforts-plugin-babel';

function babelTransformPlugin(inputFiles: ts.OutputFile[]): Promise<ts.OutputFile[]> {
  const options: babel.IOptions = {
    babelrc: false,
    // Get Babel to convert ES6 constructs Node v4 doesn't support to ES5.
    plugins: [
      'babel-plugin-transform-strict-mode',
      'babel-plugin-transform-es2015-parameters',
      'babel-plugin-transform-es2015-destructuring',
      'babel-plugin-transform-es2015-spread'
    ]
  };
  return babelTransform(inputFiles, options);
}

const server = new IncrementalBuildServer(new Logger());
ProjectLoader.loadFromConfigFile('../src/tsconfig.json')
.then(project => {
  project.postCompileTransforms.push(babelTransformPlugin);
  server.watchProject(project);
});
```

## Debugging
If you'd like to see what the code looks like before an after Babel transforms it you can use the
`babelTransformDebug` function provided by this package, it works similarly to `babelTransform`
but takes two extra arguments, these should be functions, and they will be invoked before and
after code is transformed. For example you could replace the `babelTransformPlugin` function in the
example above with the following:
```typescript
import * as fsp from 'fs-promisified';

function debugInputFile(file: ts.OutputFile): Promise<void> {
  return fsp.writeFile(file.name + '.babel_in', file.text, 'utf8');
}

function debugOutputFile(file: ts.OutputFile): Promise<void> {
  return fsp.writeFile(file.name + '.babel_out', file.text, 'utf8');
}

function babelTransformPlugin(inputFiles: ts.OutputFile[]): Promise<ts.OutputFile[]> {
  const options: babel.IOptions = { ... };
  return babelTransformDebug(inputFiles, options, writeBabelInputToFile, writeBabelOutputToFile);
}
```

## License
MIT
