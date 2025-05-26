// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import vscode = require('vscode');
import tinify = require('tinify');
import path = require('path');
import { spawnSync } from 'child_process'
import { ExtensionContext, Disposable, Uri } from 'vscode';

/**
 * Function to compress a single image.
 * @param {Object} file
 */

const compressImage = async (file: Uri) => {
    const shouldOverwrite: boolean =
        vscode.workspace
            .getConfiguration('tinypng')
            .get<boolean>('forceOverwrite') || false;

    let destinationFilePath = file.fsPath;
    if (!shouldOverwrite) {
        const postfix = vscode.workspace
            .getConfiguration('tinypng')
            .get<string>('compressedFilePostfix');
        const parsedPath = path.parse(file.fsPath);
        destinationFilePath = path.join(
            parsedPath.dir,
            `${parsedPath.name}${postfix}${parsedPath.ext}`
        );
    }

    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left
    );
    statusBarItem.text = `Compressing file ${file.fsPath}...`;
    statusBarItem.show();
    try {
        await tinify.fromFile(file.fsPath).toFile(destinationFilePath);
        statusBarItem.hide();
        vscode.window.showInformationMessage(
            `Successfully compressed ${file.fsPath} to ${destinationFilePath}!`
        );
    } catch (error: any) {
        statusBarItem.hide();
        if (error instanceof tinify.AccountError) {
            console.error(
                'Authentication failed. Have you set the API Key?'
            );
            vscode.window.showErrorMessage(
                'Authentication failed. Have you set the API Key?'
            );
        } else if (error instanceof tinify.ClientError) {
            console.error(
                'Ooops, there is an error. Please check your source image and settings.'
            );
            vscode.window.showErrorMessage(
                'Ooops, there is an error. Please check your source image and settings.'
            );
        } else if (error instanceof tinify.ServerError) {
            console.error('TinyPNG API is currently not available.');
            vscode.window.showErrorMessage(
                'TinyPNG API is currently not available.'
            );
        } else if (error instanceof tinify.ConnectionError) {
            console.error(
                'Network issue occurred. Please check your internet connectivity.'
            );
            vscode.window.showErrorMessage(
                'Network issue occurred. Please check your internet connectivity.'
            );
        } else {
            console.error(error.message);
            vscode.window.showErrorMessage(error.message);
        }
    }
};
/**
 * Validate the user.
 * @param {function} onSuccess - Function to call on success
 * @param {function} onFailure - Function to call on failure
 */
const validate = (
    onSuccess: Function = () => {},
    onFailure = (e: Error) => {}
) =>
    tinify.validate(function (err: Error | null) {
        if (err) {
            onFailure(err);
        } else {
            onSuccess();
        }
    });

const afterValidation = (callback: Function) => validate(callback);

const compressStageFiles = async (editorPath: string) => {
    try {
        const lines = spawnSync('git', ['diff', '--staged', '--diff-filter=ACMR', '--name-only', '-z'], { encoding: 'utf-8', cwd: editorPath })
        const files = lines.stdout
            .replace(/\u0000$/, '')
            .split('\u0000')
            .filter(f => /\.(png|jpg|jpeg|webp)$/.test(f))
        if (files.length === 0) {
            vscode.window.showInformationMessage(
                `TinyPNG: No images found in the git stage.`
            )
            return
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `TinyPNG: Compressing ${files.length} staged image(s)`,
            cancellable: false
        }, async (progress) => {
            let completed = 0;
            for (const f of files) {
                await compressImage(Uri.parse(`${editorPath}/${f}`));
                completed++;
                progress.report({ increment: 100 / files.length, message: `${completed}/${files.length}` });
            }
        });
    } catch(err) {
        vscode.window.showErrorMessage(
            `TinyPNG: ${(err as Error).message}`
        );
    }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
function activate(context: ExtensionContext) {
    // Get API Key
    const apiKey = vscode.workspace
        .getConfiguration('tinypng')
        .get<string>('apiKey');

    if (!!apiKey) {
        tinify.key = apiKey;
    }

    // Validate user
    validate(
        () => console.log('Validation successful!'),
        (e: Error) => {
            console.error(e.message);
            vscode.window.showInformationMessage(
                'TinyPNG: API validation failed. Be sure that you filled out tinypng.apiKey setting already.'
            );
        }
    );

    let disposableCompressFile = vscode.commands.registerCommand(
        'extension.compressFile',
        compressImage
    );

    context.subscriptions.push(disposableCompressFile);

    let disposableCompressFolder: Disposable = vscode.commands.registerCommand(
        'extension.compressFolder',
        async function (folder: Uri) {
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(folder.path, `**/*.{png,jpg,jpeg,webp}`)
            );
            if (files.length === 0) {
                vscode.window.showInformationMessage(
                    'TinyPNG: No images found in this folder.'
                );
                return;
            }
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `TinyPNG: Compressing ${files.length} image(s)`,
                    cancellable: false,
                },
                async (progress) => {
                    let completed = 0;
                    for (const file of files) {
                        await compressImage(file);
                        completed++;
                        progress.report({
                            increment: 100 / files.length,
                            message: `${completed}/${files.length}`,
                        });
                    }
                }
            );
        }
    );

    context.subscriptions.push(disposableCompressFolder);

    let disposableCompressionCount: Disposable =
        vscode.commands.registerCommand('extension.getCompressionCount', () =>
            afterValidation(() =>
                vscode.window.showInformationMessage(
                    `TinyPNG: You already used ${tinify.compressionCount} compression(s) this month.`
                )
            )
        );
    context.subscriptions.push(disposableCompressionCount);

    let disposableCompressGitStage: Disposable =
        vscode.commands.registerCommand('extension.compressGitStage', async () => {
            const folders = vscode.workspace.workspaceFolders
            if (!folders) {
                vscode.window.showInformationMessage(
                    `TinyPNG: No editor path found.`
                )
                return
            }
            if (folders.length <= 1) {
                await compressStageFiles(folders[0].uri.fsPath)
                return
            }
            const folderNames = folders.map(folder => folder.name)
            const folderName = await vscode.window.showQuickPick(folderNames)
            const folder = folders.find(folder => folder.name === folderName)
            if (folder) {
                await compressStageFiles(folder.uri.fsPath)
            }
        });

    context.subscriptions.push(disposableCompressGitStage)
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {}
exports.deactivate = deactivate;
