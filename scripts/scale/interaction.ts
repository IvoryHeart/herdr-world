import type { CDP } from "./cdp";

const cameraState = `({transform:document.querySelector('.town-world')?.getAttribute('style'),level:document.querySelector('.town-world')?.getAttribute('data-level'),desks:document.querySelectorAll('.world-semantic-target[data-kind="desk"]').length,agents:document.querySelectorAll('.world-semantic-target[data-kind="agent"]').length,camera:__scale.cameraView?.camera?{x:__scale.cameraView.camera.x,y:__scale.cameraView.camera.y,z:__scale.cameraView.camera.z,flying:__scale.cameraView.camera.flying}:null})`;

export async function observeCamera(cdp: CDP) {
  await cdp.evaluate(`(()=>{const host=document.querySelector('.town-canvas-host');const key=Object.keys(host).find(k=>k.startsWith('__reactFiber$'));if(!key)throw Error('Pinned React host-fiber camera observer unavailable');
    for(let fiber=host[key];fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook&&typeof hook==='object';hook=hook.next){const state=hook.memoizedState;const candidate=state?.current??(Array.isArray(state)?state[0]:state);if(candidate&&typeof candidate.fitAll==='function'&&candidate.camera&&candidate.drawn){__scale.cameraView=candidate;return true;}}
    throw Error('Pinned TownSceneCamera observer unavailable');})()`);
}

// Read the existing camera's public flying getter. Do not infer completion from
// a HUD transform which can publish less often than renderer animation frames.
export const cameraSettled = `new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Town camera did not settle')),110000);
  const frame=()=>{if(!__scale.cameraView.camera.flying){clearTimeout(timer);__scale.nextFrame(()=>__scale.nextFrame(()=>resolve(${cameraState})));}else __scale.nextFrame(frame);};__scale.nextFrame(frame);})`;

export async function fitSingleRoom(cdp: CDP) {
  const before = await cdp.evaluate(cameraState);
  const point = await cdp.evaluate(
    `(()=>{const e=document.querySelector('button[aria-label="Show the whole town"]');if(!e)throw Error('Missing native Town Fit control');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  for (const type of ["mousePressed", "mouseReleased"])
    await cdp.call("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: "left",
      clickCount: 1,
    });
  const after = await cdp.evaluate(cameraSettled);
  return {
    control: "Show the whole town; fixture has exactly one room",
    before,
    after,
    changed: before.transform !== after.transform,
  };
}

export async function panOnce(cdp: CDP) {
  const before = await cdp.evaluate(cameraState);
  await cdp.evaluate(`document.querySelector('.town-canvas-host').focus()`);
  for (const type of ["keyDown", "keyUp"])
    await cdp.call("Input.dispatchKeyEvent", {
      type,
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39,
    });
  const after = await cdp.evaluate(cameraSettled);
  if (before.transform === after.transform)
    throw new Error("Single trusted Town pan did not move the camera");
  return {
    control: "one ArrowRight key press; existing 60 CSS-pixel camera pan",
    before,
    after,
  };
}
