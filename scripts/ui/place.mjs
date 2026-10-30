// Choosing where a companion appears: the player clicks a square on the map. Right-click or Esc cancels.
// A square that's out of range, taken or off the scene shows why, and the player clicks again.
import {ID} from '../core/constants.mjs';
import {t} from '../i18n.mjs';

/** Client pixel → scene coordinates. */
function toScene(ev,view){
  if(typeof canvas.canvasCoordinatesFromClient==='function')return canvas.canvasCoordinatesFromClient({x:ev.clientX,y:ev.clientY});
  const r=view.getBoundingClientRect();
  return canvas.stage.worldTransform.applyInverse({x:ev.clientX-r.left,y:ev.clientY-r.top});
}

/** The module's open windows, so they can step aside while the player looks at the map. */
const ourWindows=()=>[...(foundry.applications.instances?.values?.()??[])].filter(app=>String(app.id??'').startsWith(ID)&&app.rendered&&!app.minimized);

/**
 * Resolve the top-left of the clicked square, null if cancelled, undefined if there is no canvas.
 * `validate(point)` throws a localized error for a square that can't be used.
 */
export async function pickCompanionSpot({summoner,validate}){
  const view=canvas?.app?.view??canvas?.app?.canvas;
  if(!canvas?.ready||!view)return undefined;
  const companionName=game.actors.get(String(summoner.getFlag(ID,'vestige')?.companionUuid??'').split('.')[1])?.name??'?';
  const windows=ourWindows();
  for(const app of windows)await app.minimize?.();
  const hint=ui.notifications.info(t('Companion.PickSpot',{companion:companionName}),{permanent:true});
  const size=Number(canvas.grid?.size)||100;
  const previousCursor=view.style.cursor;
  return new Promise(resolve=>{
    const finish=value=>{
      view.removeEventListener('pointerdown',down,true);
      view.removeEventListener('contextmenu',block,true);
      document.removeEventListener('keydown',key,true);
      view.style.cursor=previousCursor;
      try{ui.notifications.remove?.(hint);}catch{/* already gone */}
      for(const app of windows)app.maximize?.();
      resolve(value);
    };
    const block=ev=>{ev.preventDefault();ev.stopImmediatePropagation();};
    const down=ev=>{
      block(ev);
      if(ev.button===2)return finish(null);
      if(ev.button!==0)return;
      const p=toScene(ev,view);
      const point={x:Math.floor(p.x/size)*size,y:Math.floor(p.y/size)*size};
      try{finish(validate(point)??point);}
      catch(error){ui.notifications.warn(error?.message??String(error));}
    };
    const key=ev=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();finish(null);}};
    view.style.cursor='crosshair';
    view.addEventListener('pointerdown',down,true);
    view.addEventListener('contextmenu',block,true);
    document.addEventListener('keydown',key,true);
  });
}
