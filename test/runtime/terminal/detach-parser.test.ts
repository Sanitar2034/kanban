import { describe, expect, it, vi } from "vitest";

import { createDetachParser } from "../../../src/commands/task-attach";

const CTRL_P = 0x10;
const CTRL_Q = 0x11;
const CTRL_C = 0x03;

describe("createDetachParser", () => {
	it("forwards normal bytes immediately", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);

		expect(parse(0x61)).toEqual([0x61]); // 'a'
		expect(parse(0x62)).toEqual([0x62]); // 'b'
		expect(onDetach).not.toHaveBeenCalled();
	});

	it("triggers detach on Ctrl+P then Ctrl+Q", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);

		const result1 = parse(CTRL_P);
		expect(result1).toBeNull(); // buffered
		expect(onDetach).not.toHaveBeenCalled();

		const result2 = parse(CTRL_Q);
		expect(result2).toBeNull(); // detach consumed
		expect(onDetach).toHaveBeenCalledTimes(1);
	});

	it("forwards Ctrl+P + normal byte (both bytes)", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);

		const result1 = parse(CTRL_P);
		expect(result1).toBeNull();

		const result2 = parse(0x61); // 'a'
		expect(result2).toEqual([CTRL_P, 0x61]);
		expect(onDetach).not.toHaveBeenCalled();
	});

	it("handles Ctrl+P + Ctrl+P (stays in ctrl_p_seen, forwards one)", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);

		parse(CTRL_P); // enter ctrl_p_seen
		const result = parse(CTRL_P); // double Ctrl+P
		expect(result).toEqual([CTRL_P]); // forward one, stay in ctrl_p_seen
		expect(onDetach).not.toHaveBeenCalled();
	});

	it("can detach after double Ctrl+P by sending Ctrl+Q", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);

		parse(CTRL_P); // enter ctrl_p_seen
		parse(CTRL_P); // stay in ctrl_p_seen, forward one Ctrl+P
		parse(CTRL_Q); // detach

		expect(onDetach).toHaveBeenCalledTimes(1);
	});

	it("resets state after forwarding buffered Ctrl+P", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);

		parse(CTRL_P); // buffer
		parse(0x61); // forward [Ctrl+P, 'a'] and reset to normal

		// Now 'b' should forward immediately (normal state)
		const result = parse(0x62);
		expect(result).toEqual([0x62]);
	});

	it("handles multiple sequential detach attempts", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);

		// First detach
		parse(CTRL_P);
		parse(CTRL_Q);
		expect(onDetach).toHaveBeenCalledTimes(1);

		// Second detach
		parse(CTRL_P);
		parse(CTRL_Q);
		expect(onDetach).toHaveBeenCalledTimes(2);
	});

	it("forwards Ctrl+C as a normal byte (not special in parser)", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);

		const result = parse(CTRL_C);
		expect(result).toEqual([CTRL_C]);
		expect(onDetach).not.toHaveBeenCalled();
	});

	it("handles byte sequence from a chunk of input", () => {
		const onDetach = vi.fn();
		const parse = createDetachParser(onDetach);
		const forwarded: number[] = [];

		// Simulate: 'h', 'i', Ctrl+P, 'x', Ctrl+P, Ctrl+Q
		const bytes = [0x68, 0x69, CTRL_P, 0x78, CTRL_P, CTRL_Q];
		for (const byte of bytes) {
			const toForward = parse(byte);
			if (toForward) forwarded.push(...toForward);
		}

		// 'h' and 'i' forwarded, Ctrl+P buffered, 'x' → [Ctrl+P, 'x'], Ctrl+P buffered, Ctrl+Q → detach
		expect(forwarded).toEqual([0x68, 0x69, CTRL_P, 0x78]);
		expect(onDetach).toHaveBeenCalledTimes(1);
	});
});
