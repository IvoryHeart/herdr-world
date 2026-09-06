"""Harbor adapter for the repository's actual Ralph config, roles and backend."""
import json
import shlex

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template


class WorldRalph(BaseInstalledAgent):
    @staticmethod
    def name():
        return "world-ralph"

    def version(self):
        return "2.10.1"

    async def install(self, environment):
        await self.exec_as_agent(
            environment,
            "test -f /control/harness/ralph.yml && /opt/harness/bin/ralph --version && /opt/harness/node_modules/.bin/codex --version",
        )

    @with_prompt_template
    async def run(self, instruction, environment, context):
        if not self.model_name:
            raise ValueError("An explicit model is required")
        key = self._get_env("CODEX_API_KEY", "OPENAI_API_KEY")
        if not key:
            raise ValueError("Provide a scoped CODEX_API_KEY or OPENAI_API_KEY for an authorized live eval")
        await self._upload_config_text(
            environment, content=instruction, remote_path="/tmp/world-task.md", filename="instruction.md"
        )
        model = self.model_name.removeprefix("openai/")
        await self.exec_as_agent(
            environment,
            "node /control/scripts/agent/harbor-run.mjs " + shlex.quote(model),
            env={"CODEX_API_KEY": key}, cwd="/workspace", timeout_sec=2400,
        )

    def populate_context_post_run(self, context):
        path = self.logs_dir / "world-run.json"
        if not path.is_file():
            return
        state = json.loads(path.read_text())
        turns = state.get("turns", [])
        usages = [t["usage"] for t in turns if t.get("usage")]
        if usages:
            context.n_input_tokens = sum(u.get("input_tokens", 0) for u in usages)
            context.n_cache_tokens = sum(u.get("cached_input_tokens", 0) for u in usages)
            context.n_output_tokens = sum(u.get("output_tokens", 0) for u in usages)
        context.cost_usd = None
        context.metadata = {"world_status": state["status"], "activations": state["activations"],
                            "source_revision": state["sourceRevision"], "environment": "harbor"}
