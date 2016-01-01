// Copyright (c) 2015 Vadim Macagon
// MIT License, see LICENSE file for full terms.

import * as path from 'path';
import * as ts from 'typescript';
import * as babel from 'babel-core';
import * as SourceMap from 'source-map';
import * as _ from 'lodash';

function isSourceMappingURLComment(comment: string): boolean {
  return /^\# sourceMappingURL\=/.test(comment);
}

/**
 * Attempt to find the source map file for the given source file.
 *
 * @param sourceFile The source file for which a source map file should be found.
 * @param files List of files to search for the source map file.
 * @return Either the matching source map file from [[files]],
 *         or `undefined` if no match was found.
 */
function findSourceMapFile(sourceFile: ts.OutputFile, files: ts.OutputFile[]): ts.OutputFile {
  if (!_(sourceFile.name).endsWith('.map')) {
    const mapFilename = sourceFile.name + '.map';
    const mapFiles = files.filter(candidate => candidate.name === mapFilename);
    if (mapFiles.length > 0) {
      return mapFiles[0];
    }
  }
  return undefined;
}

function transformFile(inFile: ts.OutputFile, options: babel.IOptions, files: ts.OutputFile[]): ts.OutputFile[] {
  options.filename = inFile.name;
  options.filenameRelative = options.filename;

  // TODO: handle inline source maps
  const inMapFile = findSourceMapFile(inFile, files);
  const inMap: SourceMap.RawSourceMap = inMapFile ? JSON.parse(inMapFile.text) : undefined;
  if (inMap) {
    options.sourceMaps = true;
    options.sourceRoot = inMap.sourceRoot;
    options.sourceFileName = inMap.sources[0];
    options.sourceMapTarget = inMap.file;
    options.inputSourceMap = inMap;
  } else {
    options.sourceMaps = false;
    delete options.sourceRoot;
    delete options.sourceFileName;
    delete options.sourceMapTarget;
    delete options.inputSourceMap;
  }

  const result = babel.transform(inFile.text, options);
  const fileName = path.basename(inFile.name);
  // TODO: in theory the map filename won't change, so there's no need to remove it only to add it back in... is there?
  const sourceMappingURL = result.map ? `\n//# sourceMappingURL=${fileName}.map` : '';
  const code = result.map ? (result.code + sourceMappingURL) : result.code;
  const outSourceFile: ts.OutputFile = {
    name: inFile.name,
    text: code,
    writeByteOrderMark: inFile.writeByteOrderMark
  };
  if (inMapFile && result.map) {
    const outMapFile: ts.OutputFile = {
      name: inMapFile.name,
      text: JSON.stringify(result.map),
      writeByteOrderMark: inMapFile.writeByteOrderMark
    }
    return [outSourceFile, outMapFile];
  } else {
    return [outSourceFile];
  }
}

/**
 * Attempt to load a Babel plugin via standard NodeJS module resolution.
 *
 * @param id Identifier of the plugin module, the `babel-plugin-` prefix can be omitted.
 * @return The function exported by the plugin.
 */
function loadBabelPlugin(id: string): Function {
  let fromModule = module;
  let plugin: Function = null;
  const prefix = 'babel-plugin-';
  const idHasPrefix = (id.indexOf(prefix) === 0);
  while (!plugin && fromModule) {
    try {
      plugin = fromModule.require(id);
    } catch (err) {
      // FIXME: This needs to be a bit smarter to handle relative module paths!
      // Babel plugin modules are usually prefixed by `babel-plugin-`, but that prefix can be
      // omitted when specifying plugins in the options (in `.babelrc` for example), so if
      // module lookup fails when the prefix is missing try again with the prefix.
      if (!idHasPrefix) {
        try {
          plugin = fromModule.require(prefix + id);
        } catch (err) {
          // oh well
        }
      }
      // if the module lookup fails try again from the parent module,
      // this is handy when this module is symlinked into the consuming project
      // (via `npm link` for example)
      if (!plugin) {
        if (fromModule === module) {
          fromModule = module.parent;
        } else {
          // only try one level up under the assumption that simlink chains are rare
          fromModule = null;
        }
      }
    }
  }
  if (!plugin) {
    throw Error(`Unable to load Babel plugin '${id}'`);
  }
  return plugin;
}

function shouldTransformFile(fileName: string): boolean {
  return fileName.endsWith('.js') || fileName.endsWith('.jsx');
}

export interface Options extends babel.IOptions {
  /**
   * If set to `true` Babel plugin modules will be located and loaded using standard NodeJS module
   * resolution rather than Babel's built-in module resolution. Defaults to `false`.
   */
  enableNodeModuleResolution?: boolean;
}

export type OutputDebugFile = (file: ts.OutputFile) => Promise<void>;

export class BabelPlugin {
  constructor(private enableNodeModuleResolution: boolean, private babelOptions: babel.IOptions) {
    if (this.enableNodeModuleResolution) {
      this.babelOptions.plugins = babelOptions.plugins.map(babelPlugin =>
        (typeof babelPlugin === 'string') ? loadBabelPlugin(babelPlugin) : babelPlugin
      );
    }
    const overrides: babel.IOptions = {
      ast: false,
      shouldPrintComment: comment => !isSourceMappingURLComment(comment)
    };
    _.extend(this.babelOptions, overrides);
  }

  /**
   * Transform a bunch of files with Babel.
   *
   * @param inputFiles Files to transform, emitted either by the TypeScript compiler, or another transform.
   * @param options Options to pass through to Babel.
   * @return The transformed files.
   */
  babelTransform(inputFiles: ts.OutputFile[]): Promise<ts.OutputFile[]> {
    return Promise.resolve()
    .then(() => {
      return inputFiles.reduce((transformedFiles, inputFile) => {
        return shouldTransformFile(inputFile.name)
          ? transformedFiles.concat(transformFile(inputFile, this.babelOptions, inputFiles))
          : transformedFiles;
      }, []);
    });
  }

  /**
   * Transform a bunch of files with Babel.
   *
   * @param inputFiles Files to transform, emitted either by the TypeScript compiler, or another transform.
   * @param options Options to pass through to Babel.
   * @param debugInput Will be invoked for each input file before it is transformed with Babel.
   * @param debugOutput Will be invoked for each transformed file.
   * @return The transformed files.
   */
  babelTransformDebug(
    files: ts.OutputFile[], debugInput: OutputDebugFile, debugOutput: OutputDebugFile
  ): Promise<ts.OutputFile[]> {
    return Promise.all(files.map(debugInput))
    .then(() => this.babelTransform(files))
    .then(transformedFiles => {
      return Promise.all(transformedFiles.map(debugOutput))
      .then(() => transformedFiles);
    });
  }
}

export function createPlugin(options: Options): BabelPlugin {
  // Babel throws exceptions when it finds options that it doesn't recognize
  const babelOptions = _.omit(options, 'enableNodeModuleResolution');
  return new BabelPlugin(options.enableNodeModuleResolution, babelOptions);
}
