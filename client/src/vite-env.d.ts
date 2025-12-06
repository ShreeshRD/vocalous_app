/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module 'post-me' {
    export const Connection: any;
    export const ParentHandshake: any;
    export const WorkerMessenger: any;
    export const ChildHandshake: any;
}

interface Window {
    webkitAudioContext: typeof AudioContext;
}
