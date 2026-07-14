import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_DURATION_SECONDS = 0.25;
const MAX_DURATION_SECONDS = 30;

const resolveSafePath = (rootDir, relativePath) => {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error('Cada video debe tener una ruta segura.');
  }

  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, relativePath);
  const isInsideRoot = resolved === root || resolved.startsWith(`${root}${path.sep}`);

  if (!isInsideRoot) {
    throw new Error(`La ruta segura del video debe permanecer dentro del sitio: ${relativePath}`);
  }

  return resolved;
};

export const collectVideoJobs = (projects, rootDir) => {
  const jobs = [];

  for (const project of projects) {
    const mediaItems = Array.isArray(project.medios) ? project.medios : [];

    for (const media of mediaItems) {
      if (media.tipo !== 'video') continue;

      const start = Number(media.inicio);
      const end = Number(media.fin);
      const duration = end - start;

      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
        throw new Error(`La duración del video de “${project.titulo || project.id}” debe estar entre ${MIN_DURATION_SECONDS} y ${MAX_DURATION_SECONDS} segundos.`);
      }

      jobs.push({
        input: resolveSafePath(rootDir, media.original),
        output: resolveSafePath(rootDir, media.src),
        start,
        duration,
      });
    }
  }

  return jobs;
};

export const buildFfmpegArgs = ({ input, output, start, duration }) => [
  '-y',
  '-i', input,
  '-ss', String(start),
  '-t', String(duration),
  '-an',
  '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
  '-c:v', 'libx264',
  '-preset', 'fast',
  '-crf', '23',
  '-movflags', '+faststart',
  '-pix_fmt', 'yuv420p',
  output,
];

const getRootArgument = () => {
  const rootIndex = process.argv.indexOf('--root');
  return rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : '.';
};

const processMedia = async () => {
  const rootDir = path.resolve(getRootArgument());
  const projectsPath = path.join(rootDir, 'obras.json');
  const projects = JSON.parse(await readFile(projectsPath, 'utf8'));
  const jobs = collectVideoJobs(projects, rootDir);

  for (const job of jobs) {
    await mkdir(path.dirname(job.output), { recursive: true });
    const result = spawnSync('ffmpeg', buildFfmpegArgs(job), { stdio: 'inherit' });

    if (result.status !== 0) {
      throw new Error(`FFmpeg no pudo procesar ${path.relative(rootDir, job.input)}.`);
    }

    await rm(job.input, { force: true });
  }

  console.log(`Videos optimizados: ${jobs.length}`);
};

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  processMedia().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
