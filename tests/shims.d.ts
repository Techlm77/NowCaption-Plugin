declare module "@utils/types" {
    export type PluginNative<T> = {
      [K in keyof T]: T[K] extends (_e: unknown, ...args: infer A) => infer R ? (...args:A) => Promise<Awaited<R>> : never
    };
    export default function definePlugin(plugin: {name:string;description:string;authors:any[];start:()=>void;stop:()=>void;patches?:any[];[key:string]:any}):any;
}
declare module "@api/Settings" { export function migratePluginSettings(name:string, ...oldNames:string[]):void; }
declare module "@webpack" { export function findByProps(...props:string[]):any; }
declare const VencordNative: {pluginHelpers: {NowCaption:any}};

declare module "@webpack/common" { export const React: any; export const SelectedChannelStore:any; export const VoiceStateStore:any; export const UserStore:any; export const MediaEngineStore:any; export function createRoot(node:Element):{render:(node:any)=>void;unmount:()=>void}; }
declare module "*.css" { const css: string; export default css; }
