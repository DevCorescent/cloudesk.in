import React from "react";
import { AbsoluteFill, Audio, Composition, staticFile } from "remotion";
import { DURATION, FPS } from "./cues.js";
import { DURATION as MAIL_DURATION } from "./cues-mail.js";
import { Intro } from "./Intro";
import { MailFilm } from "./mail";
import { MailUp } from "./mail-up";
import { Launch } from "./launch";
import { Idea } from "./idea";
import { DURATION as IDEA_DURATION, FPS as IDEA_FPS } from "./idea-plan.js";
import { DURATION as LAUNCH_DURATION } from "./launch-plan.js";
import { DURATION as UP_DURATION } from "./up-plan.js";

/** The Mail film with its own soundtrack (`node music.mjs mail`). No voice. */
const Mail: React.FC = () => (
  <AbsoluteFill style={{ background: "#030304" }}>
    <MailFilm />
    <Audio src={staticFile("music-mail.wav")} volume={1} />
  </AbsoluteFill>
);

/** The upbeat Mail film (`node music-up.mjs`). */
const Up: React.FC = () => (
  <AbsoluteFill style={{ background: "#04040d" }}>
    <MailUp />
    <Audio src={staticFile("music-up.wav")} volume={1} />
  </AbsoluteFill>
);

/** The Mail launch film (`node music-launch.mjs`). */
const MailLaunch: React.FC = () => (
  <AbsoluteFill style={{ background: "#f6f7f7" }}>
    <Launch />
    <Audio src={staticFile("music-launch.wav")} volume={1} />
  </AbsoluteFill>
);

/** "What starts as an idea." — the Cloudesk launch film, at 60 fps (`node music-idea.mjs`). */
const IdeaFilm: React.FC = () => (
  <AbsoluteFill style={{ background: "#05081a" }}>
    <Idea />
    <Audio src={staticFile("music-idea.wav")} volume={1} />
  </AbsoluteFill>
);

export const Root: React.FC = () => (
  <>
    <Composition id="Intro" component={Intro} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={1920} height={1080} />
    <Composition id="Idea" component={IdeaFilm} durationInFrames={Math.round(IDEA_DURATION * IDEA_FPS)} fps={IDEA_FPS} width={1920} height={1080} />
    <Composition id="MailLaunch" component={MailLaunch} durationInFrames={Math.round(LAUNCH_DURATION * FPS)} fps={FPS} width={1920} height={1080} />
    <Composition id="MailUp" component={Up} durationInFrames={Math.round(UP_DURATION * FPS)} fps={FPS} width={1920} height={1080} />
    <Composition id="Mail" component={Mail} durationInFrames={Math.round(MAIL_DURATION * FPS)} fps={FPS} width={1920} height={1080} />
  </>
);
