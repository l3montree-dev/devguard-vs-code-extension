import * as vscode from "vscode";
import { DevGuardClient, DevGuardHttpError } from "./api/client";
import { registerCommands } from "./commands";
import * as config from "./config";
import { ConnectionManager } from "./connection";
import { InsightController } from "./controller";
import { PurlCache } from "./enrich/cache";
import { EnrichmentService } from "./enrich/enrich";
import { InsightStore } from "./insightStore";
import { Logger } from "./logger";
import { isPackageJson } from "./packageJson/parse";
import { isGoMod } from "./goMod/parse";
import { SbomDocumentProvider } from "./sbomDocuments";
import { AssetSelection } from "./selection";
import { DecorationManager } from "./ui/decorations";
import { DevGuardHoverProvider } from "./ui/hover";
import { StatusBar } from "./ui/statusBar";
import { StatusBarCommitHooks } from "./ui/statusBarCommitHooks";
import { preCommitHooksExists, /* postCommitHooksExists */ } from "./commitHooks";
import { SastController } from "./sast/controller";

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const logger = new Logger();
  const connection = new ConnectionManager(context.secrets);
  const client = new DevGuardClient(logger, connection.getToken);
  const cache = new PurlCache(context.workspaceState);
  const enrich = new EnrichmentService(client, cache);
  const store = new InsightStore();
  const decorations = new DecorationManager();
  const selection = new AssetSelection(context.workspaceState, client);
  const statusBar = new StatusBar();
  const statusBarCommitHooks = new StatusBarCommitHooks();
  const sbomProvider = new SbomDocumentProvider();
  const controller = new InsightController(
    enrich,
    decorations,
    store,
    connection,
    selection,
    logger,
  );
  const sast = new SastController(logger);

  await connection.init();
  await selection.init();

  const updateStatus = (): void =>
    statusBar.update({
      connected: connection.isConnected(),
      assetLabel: selection.getSelected()?.label,
    });
  updateStatus();

  if ((await preCommitHooksExists()) /* && (await postCommitHooksExists()) */) {
    statusBarCommitHooks.setActive(true);
  } else {
    statusBarCommitHooks.setActive(false);
  }

  const hoverSelector: vscode.DocumentSelector = [
    { language: "json", pattern: "**/package.json" },
    { language: "jsonc", pattern: "**/package.json" },
    { pattern: "**/go.mod" },
  ];

  context.subscriptions.push(
    logger,
    decorations,
    statusBar,
    statusBarCommitHooks,
    connection,
    selection,
    controller,
    sast,
    new vscode.Disposable(() => cache.dispose()),
    vscode.languages.registerHoverProvider(
      hoverSelector,
      new DevGuardHoverProvider(store),
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      SbomDocumentProvider.scheme,
      sbomProvider,
    ),
    ...registerCommands({
      client,
      connection,
      selection,
      controller,
      cache,
      sbomProvider,
      logger,
      commitHookStatusBar: statusBarCommitHooks,
    }),
  );

  context.subscriptions.push(
    connection.onDidChange(() => updateStatus()),
    selection.onDidChange(() => {
      updateStatus();
      controller.refreshVisible();
    }),
  );

  let lastApiUrl = config.getApiUrl();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (
        editor &&
        (isPackageJson(editor.document) || isGoMod(editor.document))
      ) {
        void controller.refreshDocument(editor.document);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isPackageJson(e.document) || isGoMod(e.document)) {
        controller.scheduleRefresh(e.document);
      }
    }),
    // Insight controller: refresh on save (existing behaviour)
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isPackageJson(doc) || isGoMod(doc)) {
        void controller.refreshDocument(doc);
      }
      void sast.scan(doc);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      store.delete(doc.uri);
    }),
    config.onDidChangeConfig(() => {
      const now = config.getApiUrl();
      if (now !== lastApiUrl) {
        lastApiUrl = now;
        cache.invalidateAll();
        selection.invalidateXref();
      }
      controller.refreshVisible();

      if (config.isSastEnabled()) {
        for (const editor of vscode.window.visibleTextEditors) {
          void sast.scan(editor.document);
        }
      } else {
        sast.clearAll();
      }
    }),
  );

  controller.refreshVisible();

  // Scan already-open documents on activation
  for (const editor of vscode.window.visibleTextEditors) {
    void sast.scan(editor.document);
  }

  if (connection.isConnected()) {
    void validateStoredToken(client, connection, logger, updateStatus);
  }

  logger.info("DevGuard extension activated.");
}

export function deactivate(): void {
  // Disposables registered on the context are cleaned up by VS Code.
}

async function validateStoredToken(
  client: DevGuardClient,
  connection: ConnectionManager,
  logger: Logger,
  updateStatus: () => void,
): Promise<void> {
  try {
    const who = await client.whoami();
    if (who.userID === "NO_SESSION") {
      logger.warn(
        "the saved token signature was rejected; signed features may not work.",
      );
    }
  } catch (err) {
    if (err instanceof DevGuardHttpError && err.status === 401) {
      await connection.disconnect();
      updateStatus();
      vscode.window.showWarningMessage(
        "DevGuard: your saved token is no longer recognized. Please reconnect.",
      );
    }
  }
}
