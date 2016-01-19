import * as ts from 'typescript';
import * as babel from 'babel-core';
export interface Options extends babel.IOptions {
    /**
     * If set to `true` Babel plugin modules will be located and loaded using standard NodeJS module
     * resolution rather than Babel's built-in module resolution. Defaults to `false`.
     */
    enableNodeModuleResolution?: boolean;
}
export declare type OutputDebugFile = (file: ts.OutputFile) => Promise<void>;
export declare class BabelPlugin {
    private enableNodeModuleResolution;
    private babelOptions;
    constructor(enableNodeModuleResolution: boolean, babelOptions: babel.IOptions);
    /**
     * Transform a bunch of files with Babel.
     *
     * @param inputFiles Files to transform, emitted either by the TypeScript compiler, or another transform.
     * @param options Options to pass through to Babel.
     * @return The transformed files.
     */
    babelTransform(inputFiles: ts.OutputFile[]): Promise<ts.OutputFile[]>;
    /**
     * Transform a bunch of files with Babel.
     *
     * @param inputFiles Files to transform, emitted either by the TypeScript compiler, or another transform.
     * @param options Options to pass through to Babel.
     * @param debugInput Will be invoked for each input file before it is transformed with Babel.
     * @param debugOutput Will be invoked for each transformed file.
     * @return The transformed files.
     */
    babelTransformDebug(files: ts.OutputFile[], debugInput: OutputDebugFile, debugOutput: OutputDebugFile): Promise<ts.OutputFile[]>;
}
export declare function createPlugin(options: Options): BabelPlugin;
