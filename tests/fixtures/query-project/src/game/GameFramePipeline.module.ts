export interface GameFramePipeline {
  beginUpdate(): void;
  prepareRender(): void;
}

export function beginUpdate(): void {}

export function prepareRender(): void {}

export function render(): void {}

export function update(): void {}
