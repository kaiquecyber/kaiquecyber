<div align="center">

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=500&size=22&pause=1400&color=2496FF&center=true&vCenter=true&width=620&lines=Ol%C3%A1%2C+eu+sou+o+Kaique+Silva!;Estudante+de+ADS;Desenvolvedor+Front-end+em+forma%C3%A7%C3%A3o;Transformando+ideias+em+c%C3%B3digo." alt="Apresentação animada de Kaique Silva" />


name: Generate Snake

on:
  schedule:
    - cron: "0 0 * * *"
  workflow_dispatch:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  generate:
    runs-on: ubuntu-latest

    steps:
      - name: Generate contribution snake
        uses: Platane/snk@v3
        with:
          github_user_name: kaiquecyber
          outputs: |
            dist/github-snake.svg?palette=github-dark

      - name: Publish animation
        uses: crazy-max/ghaction-github-pages@v4
        with:
          target_branch: output
          build_dir: dist
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
