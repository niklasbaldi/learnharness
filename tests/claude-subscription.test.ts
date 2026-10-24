/**
 * Claude subscription auth (fork): a Claude Pro/Max token from
 * `claude setup-token` (sk-ant-oat…) pasted into the Anthropic key field
 * must reach Anthropic as subscription (OAuth) auth — Bearer, the oauth
 * beta, never x-api-key. pi-ai does the switch by token prefix; this pins
 * it so a pi-ai upgrade that drops it fails loudly. Synthetic credentials,
 * fetch is CLOSED (never delegates).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeContext } from "@earendil-works/pi-ai";
import { piEngineForSpec } from "../src/agent/models.ts";
import { keyPlaceholder } from "../components/settings/keys-section.tsx";

const OAUTH = "sk-ant-oat01-dummy-subscription-token-MUST-NOT-LEAVE";
const API_KEY = "sk-ant-api03-dummy-plain-api-key";

function sse(): Response {
	const events = [
		{ type: "message_start", message: { id: "msg_offline", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 0 } } },
		{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
		{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
		{ type: "message_stop" },
	];
	const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function oneRequest(key: string): Promise<Headers> {
	const previous = process.env;
	const fetch = globalThis.fetch;
	const seen: Headers[] = [];
	process.env = { NODE_ENV: "test", HOME: "/nonexistent/claude-subscription-test-home", ANTHROPIC_API_KEY: key };
	globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		assert.equal(new URL(request.url).origin, "https://api.anthropic.com");
		seen.push(request.headers);
		return sse();
	};
	try {
		const engine = piEngineForSpec({ provider: "anthropic", id: "claude-haiku-4-5", thinkingLevel: "off" });
		const stream = engine.streamFn(engine.model, normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: Date.now() }] }), {});
		const message = await stream.result();
		assert.equal(message.stopReason, "stop", JSON.stringify(message));
	} finally {
		process.env = previous;
		globalThis.fetch = fetch;
	}
	assert.equal(seen.length, 1);
	return seen[0]!;
}

describe("Claude subscription token in the Anthropic key field", { concurrency: false }, () => {
	it("an sk-ant-oat token is sent as subscription (OAuth) auth", async () => {
		const headers = await oneRequest(OAUTH);
		assert.equal(headers.get("authorization"), `Bearer ${OAUTH}`);
		assert.equal(headers.get("x-api-key"), null);
		assert.match(headers.get("anthropic-beta") ?? "", /oauth-2025-04-20/);
	});

	it("a plain API key still goes out as x-api-key", async () => {
		const headers = await oneRequest(API_KEY);
		assert.equal(headers.get("x-api-key"), API_KEY);
		assert.equal(headers.get("authorization"), null);
	});

	it("the Anthropic paste field says it takes a subscription token", () => {
		assert.match(keyPlaceholder("ANTHROPIC_API_KEY"), /subscription token/);
		assert.equal(keyPlaceholder("OPENAI_API_KEY"), "Paste key…");
	});
});
