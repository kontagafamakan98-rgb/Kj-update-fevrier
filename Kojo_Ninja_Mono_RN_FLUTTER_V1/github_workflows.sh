name: Kojo CI Build
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      - name: Build RN
        run: cd apps/rn-app && npm install
      - name: Setup Flutter
        uses: subosito/flutter-action@v2
      - name: Build Flutter
        run: cd apps/flutter-app && flutter build apk
