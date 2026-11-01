import { deadline } from "./support";

export class CDP {
  private sequence = 0;
  private pending = new Map<
    number,
    ReturnType<typeof Promise.withResolvers<any>>
  >();
  constructor(readonly socket: WebSocket) {
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)),
        reply = this.pending.get(message.id);
      if (!reply) return;
      this.pending.delete(message.id);
      if (message.error) reply.reject(new Error(JSON.stringify(message.error)));
      else reply.resolve(message.result);
    };
  }
  async call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<any> {
    const id = ++this.sequence,
      response = Promise.withResolvers<any>();
    this.pending.set(id, response);
    this.socket.send(JSON.stringify({ id, method, params }));
    try {
      return await deadline(response.promise, `CDP ${method}`);
    } finally {
      this.pending.delete(id);
    }
  }
  async evaluate(expression: string) {
    const value = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (value.exceptionDetails)
      throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  }
  close() {
    this.socket.close();
  }
}

export const instrument = `(() => {
  const P = window.__scale = {commits:0, raf:0, snapshots:0, events:0, bytes:0, longTasks:[], frames:[], errors:[]};
  window.addEventListener('error',e=>P.errors.push(String(e.message)));
  let rendererId=0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),
    inject(r){this.renderers.set(++rendererId,r);return rendererId;},checkDCE(){},
    onScheduleFiberRoot(){},onCommitFiberUnmount(){},onPostCommitFiberRoot(){},onCommitFiberRoot(){P.commits++;}};
  const originalRAF=window.requestAnimationFrame.bind(window);
  P.nextFrame=originalRAF;
  window.requestAnimationFrame=callback=>originalRAF(time=>{P.raf++;callback(time);});
  let last=0;
  const frame=time=>{if(last)P.frames.push(time-last);last=time;originalRAF(frame);}; originalRAF(frame);
  try {new PerformanceObserver(list=>{for(const e of list.getEntries())P.longTasks.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
  const NativeWS=window.WebSocket;
  window.WebSocket=class extends NativeWS {constructor(...args){super(...args);this.addEventListener('message',e=>{
    if(typeof e.data!=='string')return;P.bytes+=e.data.length;
    const prefix=e.data.slice(0,256);if(prefix.includes('"connections"'))P.snapshots++;
    if(prefix.includes('"world_invalidated"'))P.events++;
  });}};
})();`;

// Event-based content wait. Two animation frames are a declared completion boundary,
// not proof of GPU completion; use the capture receipt when the baseline provides it.
export const waitContent = (
  selector: string,
  text?: string,
) => `new Promise((resolve,reject)=>{
  const check=()=>{const e=document.querySelector(${JSON.stringify(selector)});if(e${text ? `&&(document.body.textContent.includes(${JSON.stringify(text)})||document.querySelector(${JSON.stringify(`[aria-label*="${text}"]`)}))` : ""}){
    observer.disconnect();clearTimeout(timer);__scale.nextFrame(()=>__scale.nextFrame(()=>resolve(true)));}};
  const observer=new MutationObserver(check);observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
  const timer=setTimeout(()=>{observer.disconnect();reject(Error('scale content completion: '+document.body.innerText.slice(0,300)));},110000);check();})`;

export const counters = `({commits:__scale.commits,raf:__scale.raf,snapshots:__scale.snapshots,events:__scale.events,bytes:__scale.bytes,
  frameIndex:__scale.frames.length,longTaskIndex:__scale.longTasks.length,at:performance.now()})`;
