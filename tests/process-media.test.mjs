import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { buildFfmpegArgs, collectVideoJobs } from '../scripts/process-media.mjs';

test('collectVideoJobs ignores images and maps video trim metadata', () => {
  const projects = [{
    id: 'demo',
    medios: [
      { tipo: 'imagen', src: 'assets/proyectos/demo/cover.webp' },
      {
        tipo: 'video',
        original: 'assets/proyectos/demo/original/turntable.mp4',
        src: 'assets/proyectos/demo/turntable-loop.mp4',
        inicio: 1.25,
        fin: 4.75,
      },
    ],
  }];

  const jobs = collectVideoJobs(projects, '/site');

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].start, 1.25);
  assert.equal(jobs[0].duration, 3.5);
  assert.equal(jobs[0].input, path.resolve('/site/assets/proyectos/demo/original/turntable.mp4'));
  assert.equal(jobs[0].output, path.resolve('/site/assets/proyectos/demo/turntable-loop.mp4'));
});

test('collectVideoJobs rejects paths outside the site', () => {
  const projects = [{ id:'unsafe', medios:[
    { tipo:'video', original:'../secret.mp4', src:'loop.mp4', inicio:0, fin:2 },
  ] }];

  assert.throws(() => collectVideoJobs(projects, '/site'), /ruta segura/i);
});

test('collectVideoJobs rejects inverted trim points', () => {
  const projects = [{ id:'inverted', medios:[
    { tipo:'video', original:'input.mp4', src:'loop.mp4', inicio:4, fin:2 },
  ] }];

  assert.throws(() => collectVideoJobs(projects, '/site'), /duración/i);
});

test('collectVideoJobs rejects clips longer than 30 seconds', () => {
  const projects = [{ id:'long', medios:[
    { tipo:'video', original:'input.mp4', src:'loop.mp4', inicio:0, fin:31 },
  ] }];

  assert.throws(() => collectVideoJobs(projects, '/site'), /duración/i);
});

test('buildFfmpegArgs creates a silent web-compatible MP4', () => {
  const args = buildFfmpegArgs({
    input: '/site/source.mp4',
    output: '/site/loop.mp4',
    start: 2.5,
    duration: 4,
  });

  assert.deepEqual(args, [
    '-y',
    '-i', '/site/source.mp4',
    '-ss', '2.5',
    '-t', '4',
    '-an',
    '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '/site/loop.mp4',
  ]);
});
