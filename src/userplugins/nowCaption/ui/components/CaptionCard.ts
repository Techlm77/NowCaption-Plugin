import { React } from "@webpack/common";

import { MAX_CAPTIONED, runtime } from "../../core/state";

import * as diagnostic from "../../core/diagnostics";
import { clamp, fontStack, layouts, preferences, saveLayout } from "../../core/settings";
import { loadVerifiedProfile, saveVerifiedProfile } from "../../core/speakerProfiles";
import type { Layout, Slot } from "../../core/types";
import { displayName, speakerTitle } from "../identity";
import { CaptionViewModel } from "./captionModel";
import type { TileRect } from "../voiceTiles";
import { tileCaptionRect } from "../tileGeometry";

const h=(...args:any[]):any=>(React.createElement as any)(...args);
// The 22px speaker tab overlaps the caption surface by 1px; surface borders
// and 3px bottom breathing room leave exactly N full text rows inside the panel.
export const rowPx = (fontSize:number)=>Math.ceil(fontSize*1.55);
export const FRAME_HEIGHT = 26;
export const rowSnappedHeight = (height:number,fontSize:number)=>
    FRAME_HEIGHT + Math.max(2,Math.round((height-FRAME_HEIGHT)/rowPx(fontSize)))*rowPx(fontSize);
// Default spots of the open cards (at most MAX_CAPTIONED): each new card takes the first free one, so two never
// open on top of each other whatever their track numbers (A1 and A5, say).
const spotsInUse=new Set<number>();
function takeSpot():number{
    for(let i=0;i<MAX_CAPTIONED;i++) if(!spotsInUse.has(i)){spotsInUse.add(i);return i;}
    return 0;
}
const defaultLayout=(id:string,i:number):Layout=>{
    const l=layouts()[id];
    return {x:l?.x ?? 16+Math.floor(i/3)*302, y:l?.y ?? 90+(i%3)*164, width:l?.width??290, height:l?.height??145};
};

export function CaptionCard({slot,visible,tile,onRemove}: {
    slot: Slot; visible:boolean; tile?:TileRect; onRemove:(slot:Slot)=>void;
}) {
    const spot=React.useRef(null as number|null);
    if (spot.current===null) spot.current=takeSpot();
    React.useEffect(()=>()=>{ if (spot.current!==null) spotsInUse.delete(spot.current); },[]);
    const [layout,setLayout]=React.useState(()=>defaultLayout(slot.id,spot.current!));
    const card=React.useRef(null as HTMLDivElement|null);
    const scroller=React.useRef(null as HTMLDivElement|null);
    const dragging=React.useRef(null as {id:number;ox:number;oy:number}|null);
    const resizing=React.useRef(null as {id:number;startX:number;startY:number;width:number;height:number}|null);
    const follow=React.useRef(true);
    const model=React.useRef(null as CaptionViewModel|null);
    if (!model.current) model.current=new CaptionViewModel();
    const [view,setView]=React.useState(()=>model.current!.snapshot()) as [{text:string},(v:{text:string})=>void];

    // Verified profiles follow Discord IDs, never temporary A1/A2 positions.
    React.useEffect(()=>{
        if (!slot.verifiedUserId) return;
        const p=loadVerifiedProfile(slot.verifiedUserId);
        if (p?.layout) setLayout((old:Layout)=>({...old,...p.layout}));
        if (p?.color) slot.color=p.color;
    },[slot.verifiedUserId]);

    const epoch=React.useRef(slot.identityEpoch);
    React.useEffect(()=>{
        // Someone else now speaks on this track: don't show the previous person's words under the new name.
        if (epoch.current!==slot.identityEpoch) {
            epoch.current=slot.identityEpoch;
            model.current!.reset();
            setView(model.current!.snapshot());
        }
        const changed=model.current!.update(slot.text,performance.now(),slot.segment,slot.finishedText);
        slot.finishedText=undefined;
        if (changed) setView(model.current!.snapshot());
    }); // React updates are driven by the shared, throttled UI tick.
    React.useLayoutEffect(()=>{
        const node=scroller.current;
        if (node && follow.current && visible) node.scrollTop=node.scrollHeight;
    },[view,visible,layout.height,layout.width,tile?.width,tile?.height,preferences.fontSize]);

    const stopDragging=(event:any)=>{
        const drag=dragging.current;
        if(!drag || event.pointerId!==drag.id) return;
        dragging.current=null;
        try {event.currentTarget.releasePointerCapture(drag.id);} catch { /* already released */ }
        const rect=card.current?.getBoundingClientRect();
        if (!rect) return;
        const x=clamp(Math.round(rect.left),0,Math.max(0,innerWidth-rect.width));
        const y=clamp(Math.round(rect.top),0,Math.max(0,innerHeight-rect.height));
        saveLayout(slot.id,{x,y});
        if (slot.verifiedUserId) saveVerifiedProfile(slot.verifiedUserId,{layout:{x,y}});
        diagnostic.debug("card","moved",{track:slot.id,x,y});
    };
    const line=rowPx(preferences.fontSize);
    const height=rowSnappedHeight(layout.height??145,preferences.fontSize);
    const top=clamp(layout.y,0,Math.max(0,innerHeight-(FRAME_HEIGHT+2*line)-8));
    const maxRows=Math.max(2,Math.floor((innerHeight-top-FRAME_HEIGHT-8)/line));
    const clampedHeight=FRAME_HEIGHT+Math.min(maxRows,Math.max(2,Math.round((height-FRAME_HEIGHT)/line)))*line;
    const stopResizing=(event:any)=>{
        const resize=resizing.current;
        if(!resize || resize.id!==event.pointerId)return;
        resizing.current=null;
        try{event.currentTarget.releasePointerCapture(resize.id);}catch{}
        const rect=card.current?.getBoundingClientRect();
        if(!rect)return;
        const patch={width:Math.round(rect.width),height:Math.round(rect.height)};
        saveLayout(slot.id,patch);
        if(slot.verifiedUserId)saveVerifiedProfile(slot.verifiedUserId,{layout:patch});
        if(scroller.current){ follow.current=true; scroller.current.scrollTop=scroller.current.scrollHeight; }
        diagnostic.debug("card","resized",{track:slot.id,...patch});
    };
    // Never attach by UI ordering or names. The 3-row tile must fit entirely
    // inside the owner's visible participant rectangle; otherwise float.
    const tileBounds = tile && visible ? tileCaptionRect(tile, preferences.fontSize, innerWidth, innerHeight) : undefined;
    if (tileBounds) {
        const isTentative=!!slot.suggestedUserId&&!slot.verifiedUserId;
        return h("section",{
            className:"nc15-tile-caption",role:"group",
            "aria-label":`${displayName(slot)} captions${isTentative?" (probable voice-activity match)":""}`,
            title:isTentative?"Likely speaker match based on voice activity, not verified":"",
            style:{display:"flex",...tileBounds}
        }, h("div",{
            className:`nc10-text ${preferences.scrollbars==="thin"?"nc10-scroll-thin":"nc10-scroll-hidden"}`,
            ref:scroller,role:"log","aria-live":"off",
            style:{fontFamily:fontStack(preferences.font),fontSize:preferences.fontSize,
                lineHeight:`${line}px`,color:slot.color??preferences.color},
        },h("div",{className:"nc10-paragraph"},runtime.monitorOn?view.text:"Captions stopped")));
    }
    return h("section",{
        ref:card,className:"nc10-card",role:"group","aria-label":`${speakerTitle(slot)} captions`,
        style:{display:visible?"flex":"none",left:clamp(layout.x,0,Math.max(0,innerWidth-(layout.width??290))),top:clamp(top,0,Math.max(0,innerHeight-clampedHeight-8)),
            width:clamp(layout.width??290,205,Math.max(205,innerWidth-12)),height:clampedHeight}
    },
    h("header",{
        className:"nc10-card-header",
        onPointerDown:(e:any)=>{
            if(e.button!==0 || e.target.closest("button,input")) return;
            const rect=card.current!.getBoundingClientRect();
            dragging.current={id:e.pointerId,ox:e.clientX-rect.left,oy:e.clientY-rect.top};
            e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove:(e:any)=>{
            const d=dragging.current;
            if (!d || d.id!==e.pointerId) return;
            const r=card.current?.getBoundingClientRect();if(!r)return;
            setLayout((old:Layout)=>({...old,x:clamp(Math.round(e.clientX-d.ox),0,Math.max(0,innerWidth-r.width)),y:clamp(Math.round(e.clientY-d.oy),0,Math.max(0,innerHeight-r.height))}));
        },
        onPointerUp:stopDragging,onPointerCancel:stopDragging
    },
      h("span",{className:"nc14-voice-activity",role:"img",
          "aria-label":(slot.levelActiveUntil??0)>performance.now()||slot.rms>.012?"Speaking":"Quiet",
          title:(slot.levelActiveUntil??0)>performance.now()||slot.rms>.012?"Speaking":"Quiet",
          style:{color:(slot.levelActiveUntil??0)>performance.now()||slot.rms>.012?"#5ee4a0":"#8190a5"}},
          h("i"),h("i"),h("i")),
      // A voice-activity guess is shown only with "likely", never as the speaker's name.
      h("span",{className:"nc10-card-name",title:slot.suggestedUserId&&!slot.verifiedUserId?"Likely speaker from voice activity, not verified":speakerTitle(slot)},speakerTitle(slot)),
      h("span",{className:"nc14-card-actions"},
          h("button",{className:"nc10-close",type:"button",title:"Remove speaker","aria-label":`Remove ${displayName(slot)} captions`,onClick:()=>onRemove(slot)},"×"))
    ),
    h("div",{className:"nc14-card-surface"},
      h("div",{
        className:`nc10-text ${preferences.scrollbars==="thin"?"nc10-scroll-thin":"nc10-scroll-hidden"}`,
        ref:scroller,role:"log","aria-live":"off",style:{fontFamily:fontStack(preferences.font),fontSize:preferences.fontSize,lineHeight:`${line}px`,color:slot.color??preferences.color},
        onWheel:(e:any)=>{if(e.deltaY<0)follow.current=false;},
        onScroll:(e:any)=>{if(resizing.current)return;const n=e.currentTarget;follow.current=n.scrollHeight-n.scrollTop-n.clientHeight<line;}
      }, h("div",{className:"nc10-paragraph"},runtime.monitorOn?view.text:"Captions stopped"))
    ),
    h("button",{className:"nc10-resize-handle",type:"button","aria-label":`Resize ${displayName(slot)} caption box`,title:"Drag to resize by text rows",
        onPointerDown:(e:any)=>{
            if(e.button!==0)return;
            e.stopPropagation();
            const rect=card.current!.getBoundingClientRect();
            resizing.current={id:e.pointerId,startX:e.clientX,startY:e.clientY,width:rect.width,height:rect.height};
            follow.current=true;
            e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove:(e:any)=>{
            const r=resizing.current;
            if(!r||r.id!==e.pointerId)return;
            const rect=card.current?.getBoundingClientRect();if(!rect)return;
            const newWidth=clamp(Math.round(r.width+e.clientX-r.startX),205,Math.max(205,innerWidth-rect.left-8));
            const availableRows=Math.max(2,Math.floor((innerHeight-rect.top-8-FRAME_HEIGHT)/line));
            const rows=clamp(Math.round((r.height+e.clientY-r.startY-FRAME_HEIGHT)/line),2,availableRows);
            setLayout((old:Layout)=>({...old,width:newWidth,height:FRAME_HEIGHT+rows*line}));
        },
        onPointerUp:stopResizing,onPointerCancel:stopResizing
    },"◢"));
}
