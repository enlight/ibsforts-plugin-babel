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
 * Transform a bunch of files with Babel.
 *
 * @param inputFiles Files to transform, emitted either by the TypeScript compiler, or another transform.
 * @param options Options to pass through to Babel.
 * @return The transformed files.
 */
export function babelTransform(inputFiles: ts.OutputFile[], options: babel.IOptions): Promise<ts.OutputFile[]> {
  const optionsOverride: babel.IOptions = {
    ast: false,
    shouldPrintComment: comment => !isSourceMappingURLComment(comment)
  };

  return Promise.resolve()
  .then(() => {
    _.extend(options, optionsOverride);
    return inputFiles.reduce((transformedFiles, inputFile) => {
      return inputFile.name.endsWith('.map')
        ? transformedFiles
        : transformedFiles.concat(transformFile(inputFile, options, inputFiles));
    }, []);
  });
}

export type OutputDebugFile = (file: ts.OutputFile) => Promise<void>;

/**
 * Transform a bunch of files with Babel.
 *
 * @param inputFiles Files to transform, emitted either by the TypeScript compiler, or another transform.
 * @param options Options to pass through to Babel.
 * @param debugInput Will be invoked for each input file before it is transformed with Babel.
 * @param debugOutput Will be invoked for each transformed file.
 * @return The transformed files.
 */
export function babelTransformDebug(
  files: ts.OutputFile[], options: babel.IOptions,
  debugInput: OutputDebugFile, debugOutput: OutputDebugFile
): Promise<ts.OutputFile[]> {
  return Promise.all(files.map(debugInput))
  .then(() => babelTransform(files, options))
  .then(transformedFiles => {
    return Promise.all(transformedFiles.map(debugOutput))
    .then(() => transformedFiles);
  });
}
