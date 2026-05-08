# EchoStreamer – GUI and Server

## Introduction

EchoStreamer allgemeine Erklärung: Wieso, Weshalb
Auf est-core Branch und est-script Tags verweisen 

## Architecture

Struktur erklären: est-gui und est-server
est-server ist in est-gui gebundled, ist aber auch Standalone nutzbar
est-server verwendet intern GStreamer, welches wiederum innerhalb der Binary gebundled ist
--> Grafik bietet sich hier an

## Compile the different parts

est-server: Erklären (NodeJS bundled in SEA application)
est-gui: Erklären (Electron app which bundles React app using Vite bundler; Styling via TailwindCSS and shadcn/ui)
est-core: In Branch `est-core` welchseln: Dort erklärt die README alle Details

## Usage

Zeigen wie man die Binaries unter WIndows und Linux starten kann (Über Scripte, aber auch die Env Variablen erklären)

# Common issues and fixes

- AppImage Blockade
- Keine Devices aufgelistet (Linux fehler)
- Stuck on "Wait for Partner"

# Contact info

Eero Kaan
eerokaan@qu.tu-berlin.dee

------------------------

README für est-core:

Auch Usage aufführen (Quasi der Standalone Betrieb); auch auf `aplay -l` und `arecord -l` eingehen. Devices bei ALSA/Linux müssen fest angegeben werden; bei Windows theoretisch auch die WASAPI Device ID fest angebbar; hier aber eher Auto-Erkennung durch est-core typischer