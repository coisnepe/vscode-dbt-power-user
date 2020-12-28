import { DBTProject } from "./dbtProject";
import { workspace, RelativePattern, WorkspaceFolder, Uri } from "vscode";
import { ManifestCacheChangedEvent, OnManifestCacheChanged } from "./manifestCacheChangedEvent";
import { DBTClient } from "../dbt_client/dbtClient";
import { getPythonPathFromExtention } from "../utils";
import { SourceFileChangedEvent } from "./sourceFileChangedEvent";

type ManifestMetaMap = Map<Uri, DBTProject>;

export class DbtProjectContainer {
  private manifestMetaMap?: ManifestMetaMap;
  private providers: OnManifestCacheChanged[] = [];
  public dbtClient?: DBTClient;

  constructor() {
    const dbtProjectFoldersWatcher = workspace.createFileSystemWatcher(
      new RelativePattern(workspace.workspaceFolders![0].uri, '*'));
    dbtProjectFoldersWatcher.onDidCreate(async () => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.createManifests();
      await this.tryRefreshAll();
    });
    dbtProjectFoldersWatcher.onDidDelete(async () => {
      await this.createManifests();
      await this.tryRefreshAll();
    });
  }

  public async createManifests(): Promise<void> {
    if (this.manifestMetaMap !== undefined) {
      this.manifestMetaMap.forEach(dbtProject => dbtProject.cleanUp());
    }
    const folders = workspace.workspaceFolders;
    if (folders === undefined) {
      return;
    }

    const manifests: ManifestMetaMap = new Map();

    for (const folder of folders) {
      const projectUris = await this.discoverProjects(folder);
      projectUris.forEach((projectUri) => {
        manifests.set(projectUri, new DBTProject(projectUri));
      });
    }
    this.manifestMetaMap = manifests;
  }

  public async createDBTClient(): Promise<void> {
    const { pythonPath, onDidChangeExecutionDetails } = await getPythonPathFromExtention();
    if (pythonPath === undefined) {
      return;
    }
    onDidChangeExecutionDetails(async () => {
      const { pythonPath } = await getPythonPathFromExtention();
      if (this.dbtClient !== undefined) {
        this.dbtClient.destroyOldDisplayItems();
      }
      this.dbtClient = new DBTClient(pythonPath);
      await this.dbtClient.checkIfDBTIsInstalled();
    });
    this.dbtClient = new DBTClient(pythonPath);
    await this.dbtClient.checkIfDBTIsInstalled();
  }

  public addProvider(provider: OnManifestCacheChanged): void {
    if (this.manifestMetaMap === undefined) {
      console.error("Trying to add eventhandlers to an empty manifests map!");
      return;
    }
    this.providers.push(provider);
  }

  public raiseManifestChangedEvent(event: ManifestCacheChangedEvent) {
    this.providers.forEach(provider => provider.onManifestCacheChanged(event));
  }

  public raiseSourceFileChangedEvent(event: SourceFileChangedEvent) {
    if (this.dbtClient !== undefined) {
      this.dbtClient.onSourceFileChanged(event);
    }
  }

  public async tryRefreshAll(): Promise<void> {
    if (this.manifestMetaMap === undefined) {
      console.error("Trying to refresh an empty manifests map!");
      return;
    }
    this.manifestMetaMap.forEach((manifestInstance) => {
      manifestInstance.tryRefresh();
    });
  }

  public getPackageName = (currentPath: Uri): string | undefined => {
    const projectPath = this.getProjectRootpath(currentPath);
    if (projectPath === undefined) {
      return undefined;
    }

    const documentPath = currentPath.path;
    const pathSegments = documentPath.replace(projectPath.path, "").split("/");

    const insidePackage =
      pathSegments.length > 1 &&
      pathSegments[0] === DBTProject.DBT_MODULES;

    if (insidePackage) {
      return pathSegments[1];
    }
    return undefined;
  };

  public getProjectRootpath = (currentFilePath: Uri): Uri | undefined => {
    if (this.manifestMetaMap === undefined) {
      console.error("Trying to call getProjectRootpath an empty manifests map!");
      return;
    }
    for (const projectRootUri of Array.from(this.manifestMetaMap.keys())) {
      if (currentFilePath.path.startsWith(projectRootUri.path + "/")) {
        return projectRootUri;
      }
    }
    return undefined;
  };

  private async discoverProjects(folder: WorkspaceFolder): Promise<Uri[]> {
    const dbtProjectFiles = await workspace.findFiles(
      new RelativePattern(folder, `**/${DBTProject.DBT_PROJECT_FILE}`),
      new RelativePattern(folder, `**/${DBTProject.DBT_MODULES}`)
    );
    return dbtProjectFiles
      .filter((uri) => !uri.path.includes('site-packages')) // TODO verify if this is really necessary, this is necessary for me because I put the venv in the DBT project 
      .map((uri) =>
        Uri.file(uri.path.split("/")!.slice(0, -1).join("/"))
      );
  }
}

export const dbtProjectContainer = new DbtProjectContainer();
