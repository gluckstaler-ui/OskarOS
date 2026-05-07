/**
 * Vitest companion for `lib/runtime/todos.ts`.
 *
 * Covers the WP-0.2 doctrine surface:
 *   - parses well-formed TodoWrite input
 *   - tolerates missing activeForm
 *   - defaults unknown status to "pending"
 *   - drops malformed todos rather than throwing
 *   - latestTodosFromEvents returns the most-recent TodoWrite
 *   - unfinishedTodosFromEvents filters completed
 *   - both OD's `kind` shape and OskarOS's `type` shape are accepted
 */
import { describe, expect, it } from 'vitest';
import {
  parseTodoWriteInput,
  latestTodosFromEvents,
  unfinishedTodosFromEvents,
  type TodoItem,
} from './todos';

describe('parseTodoWriteInput', () => {
  it('parses well-formed TodoWrite input', () => {
    const out = parseTodoWriteInput({
      todos: [
        { content: 'Build A', activeForm: 'Building A', status: 'in_progress' },
        { content: 'Build B', activeForm: 'Building B', status: 'pending' },
        { content: 'Build C', status: 'completed' },
      ],
    });
    expect(out).toEqual<TodoItem[]>([
      { content: 'Build A', activeForm: 'Building A', status: 'in_progress' },
      { content: 'Build B', activeForm: 'Building B', status: 'pending' },
      { content: 'Build C', status: 'completed', activeForm: undefined },
    ]);
  });

  it('returns empty array for non-objects', () => {
    expect(parseTodoWriteInput(null)).toEqual([]);
    expect(parseTodoWriteInput(undefined)).toEqual([]);
    expect(parseTodoWriteInput('str')).toEqual([]);
    expect(parseTodoWriteInput(42)).toEqual([]);
  });

  it('returns empty array when todos missing or non-array', () => {
    expect(parseTodoWriteInput({})).toEqual([]);
    expect(parseTodoWriteInput({ todos: null })).toEqual([]);
    expect(parseTodoWriteInput({ todos: 'not-array' })).toEqual([]);
  });

  it('drops todos missing content', () => {
    const out = parseTodoWriteInput({
      todos: [
        { status: 'pending' }, // no content — drop
        { content: '', status: 'pending' }, // empty content — drop
        { content: 'Keep', status: 'pending' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toBe('Keep');
  });

  it('defaults unknown status to "pending"', () => {
    const out = parseTodoWriteInput({
      todos: [{ content: 'X', status: 'mystery' }],
    });
    expect(out[0]?.status).toBe('pending');
  });
});

describe('latestTodosFromEvents', () => {
  it('returns empty array when events undefined', () => {
    expect(latestTodosFromEvents(undefined)).toEqual([]);
  });

  it('finds the most recent TodoWrite (OD `kind` shape)', () => {
    const events = [
      { kind: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'old', status: 'pending' }] } },
      { kind: 'text_delta', delta: 'narration' },
      { kind: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'new', status: 'in_progress' }] } },
    ];
    const out = latestTodosFromEvents(events as never[]);
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toBe('new');
  });

  it('finds the most recent TodoWrite (OskarOS `type` shape)', () => {
    const events = [
      { type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'A', status: 'completed' }] } },
      { type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'B', status: 'in_progress' }] } },
    ];
    const out = latestTodosFromEvents(events as never[]);
    expect(out[0]?.content).toBe('B');
  });

  it('ignores non-TodoWrite tool_use events', () => {
    const events = [
      { type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'todo', status: 'pending' }] } },
      { type: 'tool_use', name: 'build_vibe', input: { name: 'vibe-1' } },
    ];
    const out = latestTodosFromEvents(events as never[]);
    expect(out[0]?.content).toBe('todo');
  });
});

describe('unfinishedTodosFromEvents', () => {
  it('drops completed entries', () => {
    const events = [
      {
        type: 'tool_use',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'done', status: 'completed' },
            { content: 'doing', status: 'in_progress' },
            { content: 'todo', status: 'pending' },
          ],
        },
      },
    ];
    const out = unfinishedTodosFromEvents(events as never[]);
    expect(out.map((t) => t.content)).toEqual(['doing', 'todo']);
  });

  it('returns empty when latest TodoWrite is all-completed', () => {
    const events = [
      {
        type: 'tool_use',
        name: 'TodoWrite',
        input: {
          todos: [{ content: 'A', status: 'completed' }],
        },
      },
    ];
    expect(unfinishedTodosFromEvents(events as never[])).toEqual([]);
  });
});
