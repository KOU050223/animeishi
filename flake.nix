{
  description = "Animeishi monorepo dev environment (Expo mobile + Cloudflare Workers API)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        # engines.node >=20 / pnpm >=9。最新寄りで固定する。
        nodejs = pkgs.nodejs_24;
        pnpm = pkgs.pnpm_10;
      in
      {
        devShells.default = pkgs.mkShell {
          name = "animeishi";

          packages = [
            # Node周り
            nodejs
            pnpm

            # 全般
            pkgs.git
            pkgs.go-task
            pkgs.lefthook
          ];

          # wrangler / expo / turbo はプロジェクト依存（node_modules）で管理。
          # nixpkgs の wrangler はソースビルドが必要でバージョンも二重管理になるため含めない。
        };
      }
    );
}
