import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { stopChrome, waitForBrowserFixture } from "./browserChrome";
import { SWIFTSHADER_FLAGS } from "./world/testing/chromeRendering";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
const root = resolve(import.meta.dir, "../..");
type Result = {
  mounted: boolean;
  entry: string | null;
  errors: string[];
  runtimeSends?: number;
  refusals?: number;
};

test
  .skipIf(!chrome)
  .each(["app", "title-spinner", "board-text", "agent-refused"] as const)(
  "the real application entry mounts and consumes its switch (%s)",
  async (preview) => {
    const spinnerPreview = preview === "title-spinner";
    const boardPreview = preview === "board-text";
    const agentRefusalPreview = preview === "agent-refused";
    const artifacts = join(root, ".agents/delivery");
    await mkdir(artifacts, { recursive: true });
    const directory = await mkdtemp(join(artifacts, "app-startup-"));
    const result = Promise.withResolvers<Result>();
    const pageRequested = Promise.withResolvers<void>();
    // Isolate development proxy traffic from any running World/Herdr instance.
    const backend = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({}),
    });
    const target = backend.url.origin;
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let vite: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      vite = await createServer({
        root: join(root, "web"),
        configFile: join(root, "web/vite.config.ts"),
        cacheDir: join(directory, "vite-cache"),
        logLevel: "silent",
        server: {
          host: "127.0.0.1",
          port: 0,
          strictPort: true,
          proxy: {
            "/ws": { target, ws: true },
            "/api": { target },
            "/manifest.json": { target },
            "/login": { target },
          },
        },
        plugins: [
          {
            name: "application-startup-observer",
            configureServer(server) {
              server.middlewares.use((request, response, next) => {
                if (request.url === "/" || request.url?.startsWith("/?"))
                  pageRequested.resolve();
                if (
                  request.url !== "/__startup_result" ||
                  request.method !== "POST"
                )
                  return next();
                let body = "";
                request.on("data", (chunk) => {
                  body += String(chunk);
                });
                request.on("end", () => {
                  result.resolve(JSON.parse(body));
                  response.end("ok");
                });
              });
            },
            transformIndexHtml: {
              order: "pre",
              handler: () => [
                {
                  tag: "script",
                  injectTo: "head-prepend",
                  children: `
          (() => {
            const errors=[]; let sent=false; let previewStarted=false;
            let inputResult={};
            const replaceState=history.replaceState.bind(history);
            history.replaceState=(state,unused,url)=>{
              if(url!=null && new URL(url,location.href).pathname!==location.pathname &&
                new URL(location.href).searchParams.has('agentInputGuard'))
                errors.push('Input refusal was not captured before routing');
              return replaceState(state,unused,url);
            };
            const report=mounted=>{
              if(sent)return;sent=true;
              fetch('/__startup_result',{method:'POST',body:JSON.stringify({mounted,
                entry:document.querySelector('script[src="/src/main.tsx"]')?.getAttribute('src')??null,errors,...inputResult})});
            };
            window.addEventListener('error',event=>{errors.push(event.message);report(false);});
            window.addEventListener('unhandledrejection',event=>{errors.push(String(event.reason));report(false);});
            const preview=async()=>{
              const task=document.querySelector('[data-testid="task-title"]');
              const raw=document.querySelector('[data-testid="raw-title"]');
              const buttons=[...document.querySelectorAll('button')];
              const frame=buttons.find(button=>button.textContent==='Next spinner frame');
              const changeTask=buttons.find(button=>button.textContent==='Change task');
              const change=(button,target)=>new Promise(resolve=>{
                const observer=new MutationObserver(()=>{observer.disconnect();resolve();});
                observer.observe(target,{subtree:true,childList:true,characterData:true});
                button.click();
              });
              if(new URL(location.href).searchParams.has('titleSpinnerFixture'))errors.push('Preview switch retained');
              if(new URL(location.href).searchParams.get('keep')!=='yes')errors.push('Other query parameter lost');
              if(task.textContent!=='π Running tests')errors.push('Initial task title differs');
              for(let index=0;index<6;index++){
                const before=raw.textContent;
                await change(frame,raw);
                if(raw.textContent===before)errors.push('Spinner did not advance');
                if(task.textContent!=='π Running tests')errors.push('Spinner changed task title');
              }
              await change(changeTask,task);
              if(task.textContent!=='π Review results')errors.push('Real task change lost');
              report(errors.length===0);
            };
            const boardText=async()=>{
              const query=()=>document.querySelector('.board-sketch-edit');
              const saved=()=>document.querySelector('[aria-label="Saved drawing text"]').textContent;
              const frame=()=>new Promise(requestAnimationFrame);
              const waitFor=condition=>new Promise(resolve=>{
                if(condition()){resolve();return;}
                const observer=new MutationObserver(()=>{if(condition()){observer.disconnect();resolve();}});
                observer.observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true,attributes:true});
              });
              const edit=async id=>{
                document.querySelector('[data-hit="'+id+'"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
                await frame();
              };
              const type=async text=>{
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(query(),text);
                query().dispatchEvent(new Event('input',{bubbles:true}));
                await frame();
              };
              const click=async label=>{
                const button=[...document.querySelectorAll('button')].find(button=>button.textContent===label);
                const event=new PointerEvent('pointerdown',{bubbles:true,cancelable:true});
                button.dispatchEvent(event);
                if(!event.defaultPrevented)throw new Error('Fixture control would blur the active editor');
                button.click();
                await frame();
              };
              const save=()=>query().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));
              if(new URL(location.href).searchParams.has('boardTextConflictFixture'))throw new Error('Preview switch retained');
              if(new URL(location.href).searchParams.get('keep')!=='yes')throw new Error('Other query parameter lost');
              await edit('a');await type('Draft A');
              await click('Other client changes A');
              await edit('b');await type('Draft B');
              await click('Finish pending save');
              if(query()?.value!=='Draft B')throw new Error('A refusal replaced B');
              if(!saved().includes('Other client A'))throw new Error('Remote A was overwritten');
              save();
              await waitFor(()=>query()?.value==='Draft A'&&saved().includes('Draft B'));
              save();
              await waitFor(()=>!query()&&saved().includes('Draft A'));
              report(true);
            };
            const inspect=()=>{
              const boundary=document.querySelector('#root > pre');
              if(boundary){errors.push(boundary.textContent);report(false);return;}
              if(${spinnerPreview} && document.querySelector('[data-testid="task-title"]')){
                if(!previewStarted){previewStarted=true;preview().catch(error=>{errors.push(String(error));report(false);});}
                return;
              }
              if(${boardPreview} && document.querySelector('[data-hit="a"]')){
                if(!previewStarted){previewStarted=true;boardText().catch(error=>{errors.push(String(error));report(false);});}
                return;
              }
              if(document.querySelector('#root .world-foundation-shell')){
                if(${agentRefusalPreview}){
                  if(location.pathname!=='/town'){requestAnimationFrame(inspect);return;}
                  if(!previewStarted){
                    previewStarted=true;
                    import('/src/testing/agentInputPreviewAcceptance.ts').then(module=>module.checkAgentInputPreview())
                      .then(result=>{inputResult=result;report(true);})
                      .catch(error=>{errors.push(String(error));report(false);});
                  }
                }else setTimeout(()=>report(true),250);
                return;
              }
              if(!sent)requestAnimationFrame(inspect);
            };
            document.addEventListener('DOMContentLoaded',inspect);
            setTimeout(()=>{errors.push('Application root did not mount');report(false);},90000);
          })();`,
                },
              ],
            },
          },
        ],
      });
      await vite.listen();
      const address = vite.resolvedUrls?.local[0];
      if (!address) throw new Error("Missing isolated dev URL");
      expect([8787, 8788, 8789]).not.toContain(Number(new URL(address).port));
      child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-component-update",
          "--disable-sync",
          "--no-proxy-server",
          "--window-size=1440,900",
          `--user-data-dir=${join(directory, "profile")}`,
          ...SWIFTSHADER_FLAGS,
          spinnerPreview
            ? address + "?titleSpinnerFixture&keep=yes"
            : boardPreview
              ? address + "?boardTextConflictFixture&keep=yes"
              : agentRefusalPreview
                ? address + "?agentInputGuard=refused"
                : address,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      const observed = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        child.exited.then((code) => {
          throw new Error(`Browser exited ${code}`);
        }),
        "Real application startup",
        95000,
      );
      expect(observed.errors).toEqual([]);
      expect(observed).toMatchObject({ mounted: true, entry: "/src/main.tsx" });
      if (agentRefusalPreview)
        expect(observed).toMatchObject({ runtimeSends: 0, refusals: 7 });
    } finally {
      backend.stop(true);
      try {
        await stopChrome(child);
      } finally {
        try {
          await vite?.close();
        } finally {
          await rm(directory, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 100,
          });
        }
      }
    }
  },
  120000,
);
