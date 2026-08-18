export class SceneManager {}

export type SceneManagerService = {
  readonly active: boolean;
};

export function createSceneManager(): SceneManager {
  return new SceneManager();
}

export function createSceneManagerService(): SceneManagerService {
  return { active: false };
}

export const scene = (): void => {};

export type SceneCommand = {};
export type SceneContext = {};
export type SceneDefinition = {};
export type SceneExecOrder = {};
export type SceneExecPass = {};
export type SceneLifecycle = {};
export type ScenePolicy = {};
export type SceneRequest = {};
export type SceneSnapshot = {};
export type SceneStack = {};
export type SceneState = {};
export type SceneView = {};

export function sceneHelper(): void {}
