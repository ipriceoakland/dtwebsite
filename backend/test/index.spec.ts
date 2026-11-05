import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Deltatime API", () => {
	it("returns the API status message when called directly", async () => {
		const request = new IncomingRequest("http://example.com/");
		const response = await worker.fetch(request, env);

		expect(await response.text()).toBe("Deltatime API is running");
	});

	it("returns the API status message through the Worker runtime", async () => {
		const response = await SELF.fetch("https://example.com/");

		expect(await response.text()).toBe("Deltatime API is running");
	});
});