// Copyright (c) 2015-2016 Vadim Macagon
// MIT License, see LICENSE file for full terms.
"use strict";
var path = require('path');
var babel = require('babel-core');
var _ = require('lodash');
function isSourceMappingURLComment(comment) {
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
function findSourceMapFile(sourceFile, files) {
    if (!_(sourceFile.name).endsWith('.map')) {
        var mapFilename = sourceFile.name + '.map';
        var mapFiles = files.filter(function (candidate) { return candidate.name === mapFilename; });
        if (mapFiles.length > 0) {
            return mapFiles[0];
        }
    }
    return undefined;
}
function transformFile(inFile, options, files) {
    options.filename = inFile.name;
    options.filenameRelative = options.filename;
    // TODO: handle inline source maps
    var inMapFile = findSourceMapFile(inFile, files);
    var inMap = inMapFile ? JSON.parse(inMapFile.text) : undefined;
    if (inMap) {
        options.sourceMaps = true;
        options.sourceRoot = inMap.sourceRoot;
        options.sourceFileName = inMap.sources[0];
        options.sourceMapTarget = inMap.file;
        options.inputSourceMap = inMap;
    }
    else {
        options.sourceMaps = false;
        delete options.sourceRoot;
        delete options.sourceFileName;
        delete options.sourceMapTarget;
        delete options.inputSourceMap;
    }
    var result = babel.transform(inFile.text, options);
    var fileName = path.basename(inFile.name);
    // TODO: in theory the map filename won't change, so there's no need to remove it only to add it back in... is there?
    var sourceMappingURL = result.map ? "\n//# sourceMappingURL=" + fileName + ".map" : '';
    var code = result.map ? (result.code + sourceMappingURL) : result.code;
    var outSourceFile = {
        name: inFile.name,
        text: code,
        writeByteOrderMark: inFile.writeByteOrderMark
    };
    if (inMapFile && result.map) {
        var outMapFile = {
            name: inMapFile.name,
            text: JSON.stringify(result.map),
            writeByteOrderMark: inMapFile.writeByteOrderMark
        };
        return [outSourceFile, outMapFile];
    }
    else {
        return [outSourceFile];
    }
}
/**
 * Attempt to load a Babel plugin via standard NodeJS module resolution.
 *
 * @param id Identifier of the plugin module, the `babel-plugin-` prefix can be omitted.
 * @return The function exported by the plugin.
 */
function loadBabelPlugin(id) {
    var fromModule = module;
    var plugin = null;
    var prefix = 'babel-plugin-';
    var idHasPrefix = (id.indexOf(prefix) === 0);
    while (!plugin && fromModule) {
        try {
            plugin = fromModule.require(id);
        }
        catch (err) {
            // FIXME: This needs to be a bit smarter to handle relative module paths!
            // Babel plugin modules are usually prefixed by `babel-plugin-`, but that prefix can be
            // omitted when specifying plugins in the options (in `.babelrc` for example), so if
            // module lookup fails when the prefix is missing try again with the prefix.
            if (!idHasPrefix) {
                try {
                    plugin = fromModule.require(prefix + id);
                }
                catch (err) {
                }
            }
            // if the module lookup fails try again from the parent module,
            // this is handy when this module is symlinked into the consuming project
            // (via `npm link` for example)
            if (!plugin) {
                if (fromModule === module) {
                    fromModule = module.parent;
                }
                else {
                    // only try one level up under the assumption that simlink chains are rare
                    fromModule = null;
                }
            }
        }
    }
    if (!plugin) {
        throw Error("Unable to load Babel plugin '" + id + "'");
    }
    return plugin;
}
function shouldTransformFile(fileName) {
    return fileName.endsWith('.js') || fileName.endsWith('.jsx');
}
function shouldDiscardFile(fileName) {
    // the original source maps are always discarded because more likely than not they will no longer
    // be accurate after Babel transforms the corresponding source file, Babel will generate a new
    // source map to replace the original one if requested
    return fileName.endsWith('.map');
}
var BabelPlugin = (function () {
    function BabelPlugin(enableNodeModuleResolution, babelOptions) {
        this.enableNodeModuleResolution = enableNodeModuleResolution;
        this.babelOptions = babelOptions;
        if (this.enableNodeModuleResolution) {
            this.babelOptions.plugins = babelOptions.plugins.map(function (babelPlugin) {
                return (typeof babelPlugin === 'string') ? loadBabelPlugin(babelPlugin) : babelPlugin;
            });
        }
        var overrides = {
            ast: false,
            shouldPrintComment: function (comment) { return !isSourceMappingURLComment(comment); }
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
    BabelPlugin.prototype.babelTransform = function (inputFiles) {
        var _this = this;
        return Promise.resolve()
            .then(function () {
            return inputFiles.reduce(function (transformedFiles, inputFile) {
                if (shouldTransformFile(inputFile.name)) {
                    return transformedFiles.concat(transformFile(inputFile, _this.babelOptions, inputFiles));
                }
                else if (shouldDiscardFile(inputFile.name)) {
                    return transformedFiles;
                }
                else {
                    return transformedFiles.concat(inputFile);
                }
            }, []);
        });
    };
    /**
     * Transform a bunch of files with Babel.
     *
     * @param inputFiles Files to transform, emitted either by the TypeScript compiler, or another transform.
     * @param options Options to pass through to Babel.
     * @param debugInput Will be invoked for each input file before it is transformed with Babel.
     * @param debugOutput Will be invoked for each transformed file.
     * @return The transformed files.
     */
    BabelPlugin.prototype.babelTransformDebug = function (files, debugInput, debugOutput) {
        var _this = this;
        return Promise.all(files.map(debugInput))
            .then(function () { return _this.babelTransform(files); })
            .then(function (transformedFiles) {
            return Promise.all(transformedFiles.map(debugOutput))
                .then(function () { return transformedFiles; });
        });
    };
    return BabelPlugin;
}());
exports.BabelPlugin = BabelPlugin;
function createPlugin(options) {
    // Babel throws exceptions when it finds options that it doesn't recognize
    var babelOptions = _.omit(options, 'enableNodeModuleResolution');
    return new BabelPlugin(options.enableNodeModuleResolution, babelOptions);
}
exports.createPlugin = createPlugin;
//# sourceMappingURL=index.js.map