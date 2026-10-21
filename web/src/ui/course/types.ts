import type { ComponentType } from 'react';

export interface Beat {
  readonly caption: string;
  readonly detail?: string;
  readonly ms: number;
}

export interface SceneProps {
  readonly beat: number;
  readonly engineer: boolean;
}

export interface Chapter {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly beats: readonly Beat[];
  readonly Scene: ComponentType<SceneProps>;
}
