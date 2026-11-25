/* eslint-disable -- openapi-typescript の生成物。手で編集せず `vp run @animeishi/api-contract#generate` で再生成する。*/
export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** ヘルスチェック・デプロイバージョン情報 */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 稼働中 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @example ok */
                            status: string;
                            /** @example 2026-01-01T00:00:00.000Z */
                            timestamp: string;
                            /** @example preview */
                            environment: string | null;
                            commitSha: string | null;
                            versionId: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/demo-sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * デモアカウント（App Store 審査・Expo Explore 用）の sign-in token を発行する
         * @description Clerk の Device Trust は新しい端末からのパスワードサインインにメールコードを求めるため、メールを受け取れない審査員と自動キャプチャはログインできない。デモアカウントに限りパスワードを照合して sign-in token（ticket）を返し、アプリは ticket でサインインする。デモアカウント以外は常に 401。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                        password: string;
                    };
                };
            };
            responses: {
                /** @description sign-in token を発行した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ticket: string;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description デモアカウントではない、またはパスワードが違う */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 試行回数の上限 */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/meishi-snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 公開名刺スナップショットをアップロードする（上書き）
         * @description PNG 画像バイナリ（5MB まで）をそのまま body に載せる。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "image/png": string;
                };
            };
            responses: {
                /** @description アップロードしたスナップショットの配信 URL */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            url: string;
                        };
                    };
                };
                /** @description PNG 以外・空・サイズ超過 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** 公開名刺スナップショットを削除する */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 削除した（無くても 204） */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分のプロフィールを取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description プロフィール */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            username: string;
                            bio: string | null;
                            favoriteQuote: string | null;
                            isPublic: boolean;
                            profileImageUrl: string | null;
                            createdAt: string;
                            updatedAt: string;
                            nowWatching: {
                                annictWorkId: number;
                                annictEpisodeId: number;
                                title: string;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                hostedImageUrl: string | null;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description プロフィールが存在しない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** プロフィールを作成・更新する */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        username?: string;
                        selectedGenres?: ("アクション" | "コメディ" | "ドラマ" | "ファンタジー" | "ホラー" | "ミステリー" | "ロマンス" | "SF" | "スポーツ" | "アドベンチャー" | "スリラー" | "歴史" | "音楽" | "日常系" | "異世界")[];
                        bio?: string;
                        favoriteQuote?: string;
                        isPublic?: boolean;
                    };
                };
            };
            responses: {
                /** @description 更新後のプロフィール */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            username: string;
                            bio: string | null;
                            favoriteQuote: string | null;
                            isPublic: boolean;
                            profileImageUrl: string | null;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/profile/visibility": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** プロフィールの公開設定を更新する */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        isPublic: boolean;
                    };
                };
            };
            responses: {
                /** @description 更新後のプロフィール */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            username: string;
                            bio: string | null;
                            favoriteQuote: string | null;
                            isPublic: boolean;
                            profileImageUrl: string | null;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/blocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分がブロックしているユーザー一覧を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description ブロック一覧（ブロック日時の降順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            blockedId: string;
                            createdAt: string;
                            username: string;
                            profileImageUrl: string | null;
                        }[];
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/profile/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * プロフィール画像（アバター）をアップロードする
         * @description 圧縮済み画像バイナリ（webp / jpeg / png、5MB まで）をそのまま body に載せる。
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "image/webp": string;
                    "image/jpeg": string;
                    "image/png": string;
                };
            };
            responses: {
                /** @description 更新後のプロフィール */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            username: string;
                            bio: string | null;
                            favoriteQuote: string | null;
                            isPublic: boolean;
                            profileImageUrl: string | null;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
                /** @description 非対応の形式・空・サイズ超過 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/meishi-assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 名刺エディタ用の画像をアップロードする
         * @description 圧縮済み画像バイナリ（webp / jpeg / png、500KB・ユーザーあたり 200 件まで）をそのまま body に載せる。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "image/webp": string;
                    "image/jpeg": string;
                    "image/png": string;
                };
            };
            responses: {
                /** @description アップロードした画像の配信 URL */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            url: string;
                        };
                    };
                };
                /** @description 非対応の形式・空・サイズ超過・件数上限 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/deletion-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** アカウント削除で消えるデータの件数を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 削除対象データの件数 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            watchHistories: number;
                            favorites: number;
                            friends: number;
                            tierLists: number;
                            workLists: number;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/deletion-feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 退会理由を匿名で記録する
         * @description 退会フローで任意入力された理由を user_id と紐付けずに保存する（集計専用）。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @default [] */
                        reasons?: string[];
                        freeText?: string;
                    };
                };
            };
            responses: {
                /** @description 記録した */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * 自分のアカウントを削除する
         * @description D1 のユーザーデータ・R2 の画像・Clerk ユーザー本体を削除する（審査要件の削除導線）。
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 削除した */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/annict/exchange": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Annict の認可コードをアクセストークンに交換する */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        code: string;
                        /** Format: uri */
                        redirectUri: string;
                        /** @enum {string} */
                        mode: "native" | "web";
                    };
                };
            };
            responses: {
                /** @description 交換結果（mode:web は連携済みフラグ、mode:native はアクセストークン） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            connected: boolean;
                            scope: string;
                            annictUserId: number;
                        } | {
                            accessToken: string;
                            scope: string;
                            annictUserId: number;
                        };
                    };
                };
                /** @description 入力エラー・認可コードが不正または期限切れ */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict 連携が構成されていない */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/annict/disconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Web 連携を解除する（保存済みトークンを削除） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 解除した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            connected: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/annict": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Annict の連携状態を確認する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 連携状態（トークン失効時も connected:false） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            connected: boolean;
                        } | {
                            connected: boolean;
                            annictUserId: number;
                            scope: string[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/import/danime/match": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * dアニメストアの作品タイトル群を Annict 作品に照合する
         * @description サブリクエスト予算を使い切った作品は status:pending で返す（クライアントが再送する）。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        works: {
                            danimeWorkId: string;
                            title: string;
                            /** @enum {string} */
                            targetState: "WATCHED" | "WATCHING";
                        }[];
                        registeredWorkIds?: number[];
                    };
                };
            };
            responses: {
                /** @description 照合結果（入力順）と検索の観測情報 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            results: {
                                danimeWorkId: string;
                                title: string;
                                /** @enum {string} */
                                targetState: "WATCHED" | "WATCHING";
                                /** @enum {string} */
                                status: "exact" | "candidates" | "none" | "pending";
                                work: {
                                    annictWorkId: number;
                                    nodeId: string | null;
                                    title: string;
                                    titleKana: string | null;
                                    titleEn: string | null;
                                    seasonName: string | null;
                                    seasonYear: number | null;
                                    imageUrl: string | null;
                                    malAnimeId: number | null;
                                } | null;
                                candidates: {
                                    annictWorkId: number;
                                    nodeId: string | null;
                                    title: string;
                                    titleKana: string | null;
                                    titleEn: string | null;
                                    seasonName: string | null;
                                    seasonYear: number | null;
                                    imageUrl: string | null;
                                    malAnimeId: number | null;
                                }[];
                            }[];
                            stats: {
                                localPassSearches: number;
                                firstPassSearches: number;
                                secondPassSearches: number;
                                pending: number;
                                elapsedMs: number;
                                retries: number;
                            };
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict 未連携 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/import/danime/episode-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 話単位の記録ジョブを登録する（実行中があれば既存を返す） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        works: {
                            danimeWorkId: string;
                            annictWorkId: number;
                            episodes: {
                                partId: string;
                                watched: boolean;
                                label: string;
                                subtitle: string;
                            }[];
                        }[];
                    };
                };
            };
            responses: {
                /** @description 実行中の既存ジョブ（created:false） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            job: {
                                id: string;
                                /** @enum {string} */
                                status: "matching" | "writing" | "completed" | "failed";
                                total: number;
                                done: number;
                                failed: number;
                                skipped: number;
                                unmatched: number;
                                error: string | null;
                                createdAt: string;
                                updatedAt: string;
                            };
                            created: boolean;
                        };
                    };
                };
                /** @description 新規に登録したジョブ（created:true） */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            job: {
                                id: string;
                                /** @enum {string} */
                                status: "matching" | "writing" | "completed" | "failed";
                                total: number;
                                done: number;
                                failed: number;
                                skipped: number;
                                unmatched: number;
                                error: string | null;
                                createdAt: string;
                                updatedAt: string;
                            } | null;
                            created: boolean;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Web の Annict 連携が無い */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description バックグラウンド処理が利用できない */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/import/danime/episode-jobs/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 最新の記録ジョブの進捗を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 最新ジョブ（無ければ null） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            job: {
                                id: string;
                                /** @enum {string} */
                                status: "matching" | "writing" | "completed" | "failed";
                                total: number;
                                done: number;
                                failed: number;
                                skipped: number;
                                unmatched: number;
                                error: string | null;
                                createdAt: string;
                                updatedAt: string;
                            } | null;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/watch-histories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分の視聴記録を取得する（Annict のライブラリと同期してから返す） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 視聴記録（更新日時の降順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            annictWorkId: number;
                            /** @enum {string} */
                            state: "WATCHING" | "WATCHED" | "ON_HOLD" | "STOP_WATCHING" | "WANNA_WATCH";
                            updatedAt: string;
                            title: string;
                            titleKana: string | null;
                            titleEn: string | null;
                            seasonName: string | null;
                            seasonYear: number | null;
                            imageUrl: string | null;
                            resolvedImageUrl: string | null;
                            imageSource: string | null;
                            imageR2Key: string | null;
                            watchersCount: number | null;
                            genres: string[] | null;
                            hostedImageUrl: string | null;
                        }[];
                    };
                };
                /** @description 未認証・Annict 未連携 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/watch-histories/{annictWorkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 作品の視聴ステータスを設定する（Annict にも反映） */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        state: "WATCHING" | "WATCHED" | "ON_HOLD" | "STOP_WATCHING" | "WANNA_WATCH";
                    };
                };
            };
            responses: {
                /** @description 保存した視聴記録 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            annictWorkId: number;
                            /** @enum {string} */
                            state: "WATCHING" | "WATCHED" | "ON_HOLD" | "STOP_WATCHING" | "WANNA_WATCH";
                            updatedAt: string;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict 未連携 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 作品が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** 作品の視聴ステータスを外す（Annict でも未設定に戻す） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 外した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description annictWorkId が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict 未連携 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 作品が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/watch-histories/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 複数作品の視聴ステータスをまとめて設定する
         * @description 作品ごとの成否を results で返す。Annict のトークン失効を検知したら残りを aborted として打ち切る。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        entries: {
                            annictWorkId: number;
                            /** @enum {string} */
                            state: "WATCHING" | "WATCHED" | "ON_HOLD" | "STOP_WATCHING" | "WANNA_WATCH";
                        }[];
                    };
                };
            };
            responses: {
                /** @description 作品ごとの結果（入力順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            results: ({
                                annictWorkId: number;
                                /** @enum {boolean} */
                                ok: true;
                            } | {
                                annictWorkId: number;
                                /** @enum {boolean} */
                                ok: false;
                                error: string;
                            })[];
                            aborted: boolean;
                            elapsedMs: number;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict 未連携 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/watch-histories/share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 視聴記録の共有トークンを取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 共有トークン（未共有なら null） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            shareToken: string | null;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /** 視聴記録を共有する（共有トークンを発行。発行済みなら同じものを返す） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 共有トークン */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            shareToken: string | null;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description ユーザーが存在しない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** 視聴記録の共有をやめる（共有トークンを失効） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 共有をやめた */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description ユーザーが存在しない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/episode-records/{annictEpisodeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 話を記録する（記録済みなら何もしない） */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictEpisodeId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 記録結果（記録済みだった場合は recorded:false） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            recorded: boolean;
                            annictRecordId: number | null;
                            recordedAt: string | null;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict 未連携 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 話が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** 話のチェックを外す（その話の記録を全件消す） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictEpisodeId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 消した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict 未連携 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 話が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害・記録一覧を取得しきれなかった */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/achievements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 実績（バッジ）一覧を取得する
         * @description 今期完走は Annict の話数マスタで判定するため、未連携・Annict 障害時はそのバッジだけ available:false になる。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 実績一覧と集計値 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            achievements: {
                                id: string;
                                /** @enum {string} */
                                kind: "watch_count" | "record_streak" | "season_completion";
                                threshold: number | null;
                                earned: boolean;
                                available: boolean;
                                progress: {
                                    current: number;
                                    target: number | null;
                                };
                                work?: {
                                    annictWorkId: number;
                                    title: string;
                                };
                            }[];
                            /** @example 2026-autumn */
                            season: string;
                            stats: {
                                watchedCount: number;
                                currentStreakWeeks: number;
                                bestStreakWeeks: number;
                            };
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/work-ratings/{annictWorkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 作品への自分の評価を取得する
         * @description D1 に評価が無く Annict 連携済みなら、Annict のレビュー評価を annictRating に初期値候補として返す。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 評価（未評価は null） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string|null} */
                            rating: "bad" | "good" | "great" | null;
                            /** @enum {string|null} */
                            annictRating: "bad" | "good" | "great" | null;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** 作品を評価する（上書き） */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        rating: "bad" | "good" | "great";
                    };
                };
            };
            responses: {
                /** @description 保存した評価 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            annictWorkId: number;
                            /** @enum {string} */
                            rating: "bad" | "good" | "great";
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 作品が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** 作品への評価を取り消す */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 取り消した（未評価でも成功） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/analysis": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 保存済みの視聴傾向分析を取得する
         * @description 直近の分析結果を返す。一度も実行していない（または生成中）の場合は null。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 分析結果（未実行なら null） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            analysis: {
                                summary: string;
                                recommendedGenres: string[];
                                sections: {
                                    key: string;
                                    title: string;
                                    insight: string;
                                    facts: {
                                        label: string;
                                        value: string;
                                    }[];
                                    evidenceWorks: {
                                        annictWorkId: number;
                                        title: string;
                                        /** @enum {string} */
                                        state: "WATCHING" | "WATCHED" | "ON_HOLD" | "STOP_WATCHING" | "WANNA_WATCH";
                                    }[];
                                }[];
                                generatedAt: string;
                                workCount: number;
                            } | null;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * 視聴履歴を Workers AI で分析する
         * @description 視聴履歴をサーバー側で集計して Workers AI に投げ、傾向テキストとおすすめジャンルに加え、根拠データ付きのレポート項目（sections）を返す。入力が変わらない間は 24h キャッシュを返し（cached=true）、生成実行はユーザーごとに 24h あたり 5 回まで（超過時は 429 + Retry-After）。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 分析結果（cached=true ならキャッシュ由来） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            analysis: {
                                summary: string;
                                recommendedGenres: string[];
                                sections: {
                                    key: string;
                                    title: string;
                                    insight: string;
                                    facts: {
                                        label: string;
                                        value: string;
                                    }[];
                                    evidenceWorks: {
                                        annictWorkId: number;
                                        title: string;
                                        /** @enum {string} */
                                        state: "WATCHING" | "WATCHED" | "ON_HOLD" | "STOP_WATCHING" | "WANNA_WATCH";
                                    }[];
                                }[];
                                generatedAt: string;
                                workCount: number;
                            };
                            cached: boolean;
                        };
                    };
                };
                /** @description 視聴履歴が空 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 生成回数制限（Retry-After ヘッダ付き） */
                429: {
                    headers: {
                        "Retry-After": string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            /** @enum {string} */
                            code: "generation_limit";
                        };
                    };
                };
                /** @description Workers AI の生成に失敗 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/analysis/recommendations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 保存済みの AI おすすめ作品を取得する
         * @description 直近のおすすめ生成結果を返す。一度も実行していない（または生成中）の場合は null。Annict トークンは不要（保存済みデータを返すだけ）。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description おすすめ結果（未実行なら null） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            recommendations: {
                                works: {
                                    annictWorkId: number;
                                    title: string;
                                    titleKana: string | null;
                                    titleEn: string | null;
                                    seasonName: string | null;
                                    seasonYear: number | null;
                                    hostedImageUrl: string | null;
                                    reason: string;
                                }[];
                                generatedAt: string;
                            } | null;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /**
         * 視聴履歴からおすすめ作品を生成する
         * @description 視聴履歴（＋保存済みの分析結果があればそれ）を入力に Workers AI でおすすめ候補を生成し、Annict searchWorks で実在する作品に照合して、本人の視聴履歴に無い作品だけを返す。入力が変わらない間は 24h キャッシュを返し（cached=true）、生成実行はユーザーごとに 24h あたり 5 回まで（超過時は 429 + Retry-After）。Annict 連携が必要（未連携は 401）。
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description おすすめ結果（cached=true ならキャッシュ由来） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            recommendations: {
                                works: {
                                    annictWorkId: number;
                                    title: string;
                                    titleKana: string | null;
                                    titleEn: string | null;
                                    seasonName: string | null;
                                    seasonYear: number | null;
                                    hostedImageUrl: string | null;
                                    reason: string;
                                }[];
                                generatedAt: string;
                            };
                            cached: boolean;
                        };
                    };
                };
                /** @description 視聴履歴が空 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 / Annict 連携が必要 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 生成回数制限（Retry-After ヘッダ付き） */
                429: {
                    headers: {
                        "Retry-After": string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            /** @enum {string} */
                            code: "generation_limit";
                        };
                    };
                };
                /** @description Workers AI または Annict との通信に失敗 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/works/catalog-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 運営者の共用トークンで作品を閲覧できるかを返す */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 共用トークンの有無 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            sharedCatalogAvailable: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/works/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 作品を検索する（title 指定で人気順、無指定でシーズン一覧）
         * @description 本人の Annict トークンが無ければ運営者の共用トークンで読む。どちらも無ければ 401（code: annict_token_required）。
         */
        get: {
            parameters: {
                query?: {
                    title?: string;
                    season?: string;
                    after?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 検索結果の 1 ページ */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            works: {
                                annictWorkId: number;
                                nodeId: string;
                                state: string | null;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                malAnimeId: number | null;
                                media?: string | null;
                                watchersCount?: number | null;
                                resolvedImageUrl: string | null;
                                hostedImageUrl: string | null;
                                genres: string[] | null;
                            }[];
                            hasNextPage: boolean;
                            endCursor: string | null;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict トークンが無い */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 共用トークンが使えない（本人の Annict 連携が必要） */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/works/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * annictWorkId の一覧から作品メタを引く（D1 キャッシュ優先）
         * @description 本人の Annict トークンが無ければ運営者の共用トークンで読む。どちらも無ければ 401（code: annict_token_required）。
         */
        get: {
            parameters: {
                query: {
                    /** @description カンマ区切りの annictWorkId（最大 50 件） */
                    ids: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 見つかった作品（ids の順。見つからない ID は含めない） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            works: {
                                annictWorkId: number;
                                nodeId: string | null;
                                state: string | null;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                malAnimeId: number | null;
                                media?: string | null;
                                watchersCount?: number | null;
                                resolvedImageUrl: string | null;
                                hostedImageUrl: string | null;
                                genres: string[] | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict トークンが無い */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 共用トークンが使えない（本人の Annict 連携が必要） */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/works/candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** D1 キャッシュ済みの作品から候補を引く（Annict トークン不要） */
        get: {
            parameters: {
                query?: {
                    title?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 候補（人気順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            works: {
                                annictWorkId: number;
                                nodeId: string | null;
                                state: null;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                malAnimeId: number | null;
                                media?: string | null;
                                watchersCount?: number | null;
                                resolvedImageUrl: string | null;
                                hostedImageUrl: string | null;
                                genres: string[] | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/works/{annictWorkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 作品の詳細を取得する
         * @description 本人の Annict トークンが無ければ運営者の共用トークンで読む。どちらも無ければ 401（code: annict_token_required）。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 作品の詳細 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            work: {
                                annictWorkId: number;
                                nodeId: string;
                                state: string | null;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                malAnimeId: number | null;
                                media: string;
                                watchersCount: number;
                                resolvedImageUrl: string | null;
                                hostedImageUrl: string | null;
                                genres: string[] | null;
                                titleRo: string | null;
                                episodesCount: number;
                                noEpisodes: boolean;
                                reviewsCount: number;
                                satisfactionRate: number | null;
                                officialSiteUrl: string | null;
                                officialSiteUrlEn: string | null;
                                wikipediaUrl: string | null;
                                wikipediaUrlEn: string | null;
                                twitterUsername: string | null;
                                twitterHashtag: string | null;
                                staffs: {
                                    annictStaffId: number;
                                    name: string;
                                    role: string;
                                    resource: {
                                        /** @enum {string} */
                                        kind: "person" | "organization";
                                        annictId: number;
                                    };
                                }[];
                                casts: {
                                    annictCastId: number;
                                    annictPersonId: number;
                                    personName: string;
                                    characterName: string | null;
                                    sortNumber: number;
                                }[];
                            };
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict トークンが無い */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 作品が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 共用トークンが使えない（本人の Annict 連携が必要） */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/works/{annictWorkId}/characters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 作品のキャラクター一覧を取得する
         * @description 本人の Annict トークンが無ければ運営者の共用トークンで読む。どちらも無ければ 401（code: annict_token_required）。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description キャラクター（キャスト順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            work: {
                                annictWorkId: number;
                                nodeId: string;
                                state: string | null;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                malAnimeId: number | null;
                                media?: string | null;
                                watchersCount?: number | null;
                            };
                            characters: {
                                annictCharacterId: number;
                                name: string;
                                nameKana: string | null;
                                nameEn: string | null;
                                sortNumber: number;
                                imageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict トークンが無い */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 作品が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 共用トークンが使えない（本人の Annict 連携が必要） */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/works/{annictWorkId}/episodes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 作品の話数一覧と自分の記録状況を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 話数一覧（sortNumber 順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            episodes: {
                                annictEpisodeId: number;
                                number: number | null;
                                numberText: string | null;
                                sortNumber: number;
                                title: string | null;
                                watched: boolean;
                                recordsCount: number;
                                lastRecordedAt: string | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証・Annict 未連携 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 作品が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description Annict のレート制限（混雑） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description Annict の障害 */
                502: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/favorites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分の推し一覧を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 推し一覧（登録日時の降順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            annictWorkId: number;
                            createdAt: string;
                            title: string;
                            titleKana: string | null;
                            titleEn: string | null;
                            seasonName: string | null;
                            seasonYear: number | null;
                            imageUrl: string | null;
                            resolvedImageUrl: string | null;
                            imageSource: string | null;
                            imageR2Key: string | null;
                            hostedImageUrl: string | null;
                        }[];
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/favorites/{annictWorkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 作品を推しに登録する（冪等） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 登録した推し作品 */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            annictWorkId: number;
                            createdAt: string;
                        };
                    };
                };
                /** @description annictWorkId が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 作品が見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** 推しを解除する（冪等） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    annictWorkId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 解除した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description annictWorkId が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friends": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分のフレンド一覧を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description フレンド一覧（登録日時の降順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            friendId: string;
                            createdAt: string;
                            /** @enum {string|null} */
                            source: "qr" | "request" | null;
                            username: string;
                            bio: string | null;
                            favoriteQuote: string | null;
                            profileImageUrl: string | null;
                            meishiSnapshotUrl: string | null;
                        }[];
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /** 対面 QR 交換でフレンドを即時追加する（双方向・冪等。qrToken または offlineToken 必須。既フレンドとの再交換は再会として記録） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        friendId: string;
                        qrToken?: string;
                        offlineToken?: string;
                        scannedAt?: string;
                    };
                };
            };
            responses: {
                /** @description 追加したフレンド */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            friendId: string;
                            createdAt: string;
                            meetingCount: number;
                            recordId: number | null;
                        };
                    };
                };
                /** @description 自分自身の追加・入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description ブロック関係にある相手 / qrToken・offlineToken が無い・無効・期限切れ */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
                /** @description 対象ユーザーが存在しない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friends/qr-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 対面 QR 交換用のトークンを発行する（自分の QR に埋め込む。qt は約 5 分、ot は 24 時間有効） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 発行したトークン */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            token: string;
                            expiresAt: number;
                            offlineToken: string;
                            offlineExpiresAt: number;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friends/{friendId}/note": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 相手の私用メモを取得する（名刺帳・本人のみ。フレンドでなければ 404） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    friendId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 私用メモ（未作成なら body/updatedAt は null） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            body: string | null;
                            updatedAt: string | null;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description フレンドではない（またはユーザーが存在しない） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** 相手の私用メモを上書き保存する（500 文字まで。空文字は削除。フレンドでなければ 404） */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    friendId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        body: string;
                    };
                };
            };
            responses: {
                /** @description 保存したメモ（空文字なら削除され body/updatedAt は null） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            body: string | null;
                            updatedAt: string | null;
                        };
                    };
                };
                /** @description メモが 500 文字を超えるなどの入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description フレンドではない（またはユーザーが存在しない） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friends/{friendId}/updates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 名刺帳の相手の近況を新しい順に取得する（フレンドでなければ 404、相手が非公開なら空） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    friendId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 近況（今期作品の視聴ステータス・推しの変更・名刺の更新）を新しい順に最大件数まで */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: number | null;
                                /** @enum {string} */
                                type: "watch_status" | "favorite_added" | "meishi_updated";
                                createdAt: string;
                                work: {
                                    annictWorkId: number;
                                    title: string;
                                    titleEn: string | null;
                                    hostedImageUrl: string | null;
                                } | null;
                                meta: {
                                    [key: string]: unknown;
                                } | null;
                            }[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description フレンドではない（またはユーザーが存在しない） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friends/{friendId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** フレンドを解除する（双方向・冪等） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    friendId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 解除した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/exchange-records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分の交換記録一覧を取得する（本人のみ。相手・第三者には返さない） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 交換記録（会った日時の降順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            friendId: string;
                            /** @enum {string|null} */
                            source: "qr" | "request" | "manual" | null;
                            metAt: string;
                            placeName: string | null;
                            eventSlug: string | null;
                            eventName: string | null;
                            cardSnapshotUrl: string | null;
                            createdAt: string;
                            updatedAt: string;
                        }[];
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /** 名刺帳から手動で「会った」記録を足す（本人のみ・自分だけの記録。フレンドでなければ 404。同日・同じ場所／イベントは既存記録にまとめる） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        friendId: string;
                        /** @default null */
                        placeName?: string | null;
                        /** @default null */
                        eventSlug?: string | null;
                        /** @default null */
                        eventName?: string | null;
                    };
                };
            };
            responses: {
                /** @description 同日・同じ場所／イベントの既存記録にまとめた */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            friendId: string;
                            /** @enum {string|null} */
                            source: "qr" | "request" | "manual" | null;
                            metAt: string;
                            placeName: string | null;
                            eventSlug: string | null;
                            eventName: string | null;
                            cardSnapshotUrl: string | null;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
                /** @description 作成した交換記録 */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            friendId: string;
                            /** @enum {string|null} */
                            source: "qr" | "request" | "manual" | null;
                            metAt: string;
                            placeName: string | null;
                            eventSlug: string | null;
                            eventName: string | null;
                            cardSnapshotUrl: string | null;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
                /** @description 入力エラー / 存在しないイベント slug */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description フレンドではない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/exchange-records/{recordId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 交換記録の場所・イベントを上書きする（本人のみ。他人の記録は 404） */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    recordId: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        placeName: string | null;
                        eventSlug: string | null;
                        eventName: string | null;
                    };
                };
            };
            responses: {
                /** @description 更新した交換記録 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            friendId: string;
                            /** @enum {string|null} */
                            source: "qr" | "request" | "manual" | null;
                            metAt: string;
                            placeName: string | null;
                            eventSlug: string | null;
                            eventName: string | null;
                            cardSnapshotUrl: string | null;
                            createdAt: string;
                            updatedAt: string;
                        };
                    };
                };
                /** @description 入力エラー / 存在しないイベント slug */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 記録が存在しない（または自分の記録ではない） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** 交換記録を削除する（本人のみ。他人の記録は 404） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    recordId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 削除した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 記録が存在しない（または自分の記録ではない） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/exchange-records/{recordId}/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 交換当時の名刺コピーを配信する（本人のみ。他人の記録は 404） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    recordId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 名刺コピー画像 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "image/png": string;
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description recordId が不正・記録やコピーが存在しない（または自分の記録ではない） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/social-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分の SNS リンク一覧を取得する（全公開範囲） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 表示順の SNS リンク */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** @enum {string} */
                                kind: "x" | "pixiv" | "fanbox" | "dlsite" | "dmm" | "youtube" | "other";
                                value: string;
                                /** @enum {string} */
                                visibility: "public" | "friends" | "private";
                                url: string;
                            }[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** 自分の SNS リンクを丸ごと置き換える（配列の順が表示順） */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        items: {
                            /** @enum {string} */
                            kind: "x" | "pixiv" | "fanbox" | "dlsite" | "dmm" | "youtube" | "other";
                            value: string;
                            /**
                             * @default friends
                             * @enum {string}
                             */
                            visibility?: "public" | "friends" | "private";
                        }[];
                    };
                };
            };
            responses: {
                /** @description 置き換え後の SNS リンク */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** @enum {string} */
                                kind: "x" | "pixiv" | "fanbox" | "dlsite" | "dmm" | "youtube" | "other";
                                value: string;
                                /** @enum {string} */
                                visibility: "public" | "friends" | "private";
                                url: string;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friend-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分のフレンド申請一覧を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 届いた申請（received）と送った申請（sent） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            received: {
                                id: number;
                                userId: string;
                                createdAt: string;
                                username: string;
                                bio: string | null;
                                favoriteQuote: string | null;
                                profileImageUrl: string | null;
                            }[];
                            sent: {
                                id: number;
                                userId: string;
                                createdAt: string;
                                username: string;
                                bio: string | null;
                                favoriteQuote: string | null;
                                profileImageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /** フレンド申請を送る（冪等）。相手からの申請済みなら即成立 */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        userId: string;
                    };
                };
            };
            responses: {
                /** @description 申請結果（pending: 申請中 / accepted: 相互申請で即成立） */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "pending" | "accepted";
                            request: {
                                id: number;
                                requesterId: string;
                                addresseeId: string;
                                createdAt: string;
                            } | null;
                        };
                    };
                };
                /** @description 自分自身への申請・入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description ブロック関係にある相手 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 対象ユーザーが存在しない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description すでにフレンド */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description レート制限（Retry-After ヘッダ付き） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friend-requests/{id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 届いたフレンド申請を承認する */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 承認した（フレンド成立） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description ブロック関係にある相手 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 申請が存在しない・自分宛ではない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friend-requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** フレンド申請を削除する（受信者の拒否・送信者の取消。冪等性は無く 404） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 削除した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 申請が存在しない・当事者ではない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friend-thanks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 届いた・送ったお礼の一覧を取得する（本人のみ。第三者には返さない） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 届いたお礼（received）と送ったお礼（sent）、各新しい順 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            received: {
                                id: number;
                                userId: string;
                                username: string;
                                profileImageUrl: string | null;
                                /** @enum {string} */
                                presetKey: "thanks_for_card" | "enjoyed_talking" | "see_you_again" | "recommendations";
                                body: string | null;
                                createdAt: string;
                                readAt: string | null;
                            }[];
                            sent: {
                                id: number;
                                userId: string;
                                username: string;
                                profileImageUrl: string | null;
                                /** @enum {string} */
                                presetKey: "thanks_for_card" | "enjoyed_talking" | "see_you_again" | "recommendations";
                                body: string | null;
                                createdAt: string;
                            }[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /** フレンドにお礼を送る（定型文 1 つ＋任意の 1 行。日本時間の 1 日 1 通まで。フレンドでなければ 404、同日再送は 409） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        friendId: string;
                        /** @enum {string} */
                        presetKey: "thanks_for_card" | "enjoyed_talking" | "see_you_again" | "recommendations";
                        /** @default null */
                        body?: string | null;
                    };
                };
            };
            responses: {
                /** @description 送ったお礼 */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            username: string;
                            profileImageUrl: string | null;
                            /** @enum {string} */
                            presetKey: "thanks_for_card" | "enjoyed_talking" | "see_you_again" | "recommendations";
                            body: string | null;
                            createdAt: string;
                        };
                    };
                };
                /** @description 入力エラー（定型文キー・ひとことの形式） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description フレンドではない（ブロック関係も含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 同じ相手へ日本時間の同日に再送した */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friend-thanks/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 届いたお礼を既読にする（friendId 指定でその相手からの分だけ。受け手本人のみ） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        friendId?: string;
                    };
                };
            };
            responses: {
                /** @description 既読にした */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/friend-thanks/{thanksId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** 送ったお礼を取り消す（送り手本人のみ。他人のお礼は 404） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    thanksId: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 削除した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description お礼が存在しない（または自分が送ったものではない） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/feed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** フレンドの活動フィードを新しい順に取得する */
        get: {
            parameters: {
                query?: {
                    cursor?: string;
                    limit?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description フレンドの活動（id 降順のカーソルページング） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: number;
                                /** @enum {string} */
                                type: "watch_status" | "favorite_added" | "tier_list_created" | "tier_list_shared";
                                createdAt: string;
                                actor: {
                                    userId: string;
                                    username: string;
                                    profileImageUrl: string | null;
                                };
                                work: {
                                    annictWorkId: number;
                                    title: string;
                                    titleEn: string | null;
                                    hostedImageUrl: string | null;
                                } | null;
                                meta: {
                                    [key: string]: unknown;
                                } | null;
                            }[];
                            nextCursor: number | null;
                        };
                    };
                };
                /** @description クエリが不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/feed/stories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 直近24時間に視聴記録をつけたフレンドとその活動を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description フレンドごとの watch_status 活動（ストーリー表示用。ページングなし） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            friends: {
                                actor: {
                                    userId: string;
                                    username: string;
                                    profileImageUrl: string | null;
                                };
                                items: {
                                    id: number;
                                    createdAt: string;
                                    work: {
                                        annictWorkId: number;
                                        title: string;
                                        titleEn: string | null;
                                        hostedImageUrl: string | null;
                                    } | null;
                                    meta: {
                                        [key: string]: unknown;
                                    } | null;
                                }[];
                            }[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/articles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開中の特集記事を公開開始の新しい順に取得する */
        get: {
            parameters: {
                query?: {
                    limit?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 公開中の記事（published_at 降順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                slug: string;
                                title: string;
                                coverImageUrl: string | null;
                                publishedAt: string;
                            }[];
                        };
                    };
                };
                /** @description クエリが不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/articles/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開中の特集記事を 1 件取得する（本文 Markdown つき） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 記事の詳細 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            slug: string;
                            title: string;
                            body: string;
                            coverImageUrl: string | null;
                            publishedAt: string;
                        };
                    };
                };
                /** @description slug の形式が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 記事が存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開中のイベントを会期開始の早い順に取得する */
        get: {
            parameters: {
                query?: {
                    limit?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 公開中のイベント（starts_at 昇順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                slug: string;
                                title: string;
                                coverImageUrl: string | null;
                                location: string | null;
                                startsAt: string;
                                endsAt: string;
                                participating: boolean;
                            }[];
                        };
                    };
                };
                /** @description クエリが不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開中のイベントを 1 件取得する（説明文 Markdown つき） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description イベントの詳細 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            slug: string;
                            title: string;
                            body: string | null;
                            coverImageUrl: string | null;
                            location: string | null;
                            officialUrl: string | null;
                            startsAt: string;
                            endsAt: string;
                            participating: boolean;
                            /** @enum {string|null} */
                            participationVisibility: "public" | "friends" | "private" | null;
                        };
                    };
                };
                /** @description slug の形式が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description イベントが存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/{slug}/participation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** イベントへの「参加する」を表明する（冪等。本人にのみ見え、フレンドには公開されない） */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 表明した（すでに表明済みでも成功） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description slug の形式が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description イベントが存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** イベントへの参加表明を取り消す（冪等） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 取り消した（未表明でも成功） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description slug の形式が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        /** 参加表明の公開範囲を変更する（public / friends / private。参加表明が必要） */
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        visibility: "public" | "friends" | "private";
                    };
                };
            };
            responses: {
                /** @description 公開範囲を更新した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description slug の形式またはボディが不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description そのイベントに参加表明していない */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description イベントが存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/events/{slug}/participants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** イベントの参加者一覧と参加しているフレンドを取得する（公開範囲・プロフィール公開・ブロックで絞る） */
        get: {
            parameters: {
                query?: {
                    limit?: string;
                    offset?: string;
                    friendsLimit?: string;
                    friendsOffset?: string;
                };
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 公開表明した参加者（参加表明の早い順・limit+offset でページング）と参加しているフレンド（friendsLimit+friendsOffset でページング）、各欄の総数 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            participants: {
                                userId: string;
                                username: string;
                                bio: string | null;
                                favoriteQuote: string | null;
                                profileImageUrl: string | null;
                            }[];
                            participantTotal: number;
                            friends: {
                                userId: string;
                                username: string;
                                bio: string | null;
                                favoriteQuote: string | null;
                                profileImageUrl: string | null;
                            }[];
                            friendsTotal: number;
                        };
                    };
                };
                /** @description slug の形式またはクエリが不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description イベントが存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/{slug}/exchanged-friends": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** そのイベントの会期中にフレンド成立した相手を取得する（参加表明が必要。本人のみ） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 会期中に成立したフレンド（成立時刻の降順） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                friendId: string;
                                createdAt: string;
                                /** @enum {string|null} */
                                source: "qr" | "request" | null;
                                username: string;
                                bio: string | null;
                                favoriteQuote: string | null;
                                profileImageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description slug の形式が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description そのイベントに参加表明していない */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description イベントが存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/elections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開中の総選挙を取得する（未終了を先に、終了済みは終了の新しい順） */
        get: {
            parameters: {
                query?: {
                    limit?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 公開中の総選挙 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                slug: string;
                                title: string;
                                coverImageUrl: string | null;
                                startsAt: string;
                                endsAt: string;
                                voted: boolean;
                            }[];
                        };
                    };
                };
                /** @description クエリが不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/elections/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開中の総選挙を 1 件取得する（候補一覧と自分の票つき） */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 総選挙の詳細（候補は position 順、得票数は含まない） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            slug: string;
                            title: string;
                            body: string | null;
                            coverImageUrl: string | null;
                            startsAt: string;
                            endsAt: string;
                            votedCandidateId: number | null;
                            candidates: {
                                id: number;
                                /** @enum {string} */
                                kind: "character" | "work";
                                annictId: number;
                                name: string;
                                imageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description slug の形式が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 総選挙が存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/elections/{slug}/vote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 総選挙に投票する（冪等。1 アカウント 1 票で、期間中は投票先を変えられる） */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        candidateId: number;
                    };
                };
            };
            responses: {
                /** @description 投票した（同じ候補への再投票・投票先変更も成功） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description slug の形式またはボディが不正（その総選挙に無い候補を含む） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 投票期間外 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 総選挙が存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** 総選挙の投票を取り消す（冪等。投票期間中のみ） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    slug: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 取り消した（未投票でも成功） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description slug の形式が不正 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 投票期間外 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 総選挙が存在しないか公開期間外 */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/pass/meishi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Apple Wallet 用 pass.json の中身をプレビューする
         * @description 署名証明書が無くても叩ける（開発用）。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description pass.json */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            formatVersion: number;
                            passTypeIdentifier: string;
                            teamIdentifier: string;
                            serialNumber: string;
                            organizationName: string;
                            description: string;
                            backgroundColor: string;
                            foregroundColor: string;
                            labelColor: string;
                            barcodes?: {
                                /** @enum {string} */
                                format: "PKBarcodeFormatQR";
                                message: string;
                                /** @enum {string} */
                                messageEncoding: "iso-8859-1";
                            }[];
                            storeCard: {
                                primaryFields: {
                                    key: string;
                                    label: string;
                                    value: string;
                                }[];
                                secondaryFields: {
                                    key: string;
                                    label: string;
                                    value: string;
                                }[];
                                auxiliaryFields: {
                                    key: string;
                                    label: string;
                                    value: string;
                                }[];
                                backFields: {
                                    key: string;
                                    label: string;
                                    value: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description プロフィールが無い */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/work-lists": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 自分の作品リスト一覧を取得する
         * @description contains を渡すと、各リストにその作品が入っているかを containsWork で返す。
         */
        get: {
            parameters: {
                query?: {
                    contains?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 作品リスト（内容は含まない） */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            title: string;
                            description: string | null;
                            shareToken: string | null;
                            isPublic: boolean;
                            createdAt: string;
                            updatedAt: string;
                            itemCount: number;
                            containsWork: boolean;
                        }[];
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        /** 作品リストを作る */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        title: string;
                        description?: string | null;
                        isPublic?: boolean;
                        items: {
                            annictWorkId: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description 作った作品リスト */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            title: string;
                            description: string | null;
                            shareToken: string | null;
                            isPublic: boolean;
                            createdAt: string;
                            updatedAt: string;
                            items: {
                                annictWorkId: number;
                                position: number;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                resolvedImageUrl: string | null;
                                imageSource: string | null;
                                imageR2Key: string | null;
                                watchersCount: number | null;
                                hostedImageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー・未キャッシュの作品（annictWorkIds に列挙） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            annictWorkIds?: number[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/work-lists/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 自分の作品リストを取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 作品リストと内容 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            title: string;
                            description: string | null;
                            shareToken: string | null;
                            isPublic: boolean;
                            createdAt: string;
                            updatedAt: string;
                            items: {
                                annictWorkId: number;
                                position: number;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                resolvedImageUrl: string | null;
                                imageSource: string | null;
                                imageR2Key: string | null;
                                watchersCount: number | null;
                                hostedImageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 作品リストが見つからない（他人のリストを含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** 作品リストを丸ごと置き換える */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        title: string;
                        description?: string | null;
                        isPublic?: boolean;
                        items: {
                            annictWorkId: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description 置き換え後の作品リスト */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            title: string;
                            description: string | null;
                            shareToken: string | null;
                            isPublic: boolean;
                            createdAt: string;
                            updatedAt: string;
                            items: {
                                annictWorkId: number;
                                position: number;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                resolvedImageUrl: string | null;
                                imageSource: string | null;
                                imageR2Key: string | null;
                                watchersCount: number | null;
                                hostedImageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー・未キャッシュの作品（annictWorkIds に列挙） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            annictWorkIds?: number[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 作品リストが見つからない（他人のリストを含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** 作品リストを削除する */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 削除した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 作品リストが見つからない（他人のリストを含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/work-lists/{id}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 作品リストの末尾に作品を 1 件足す（登録済みなら何もしない） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        annictWorkId: number;
                    };
                };
            };
            responses: {
                /** @description 追加後の作品リスト */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            userId: string;
                            title: string;
                            description: string | null;
                            shareToken: string | null;
                            isPublic: boolean;
                            createdAt: string;
                            updatedAt: string;
                            items: {
                                annictWorkId: number;
                                position: number;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                resolvedImageUrl: string | null;
                                imageSource: string | null;
                                imageR2Key: string | null;
                                watchersCount: number | null;
                                hostedImageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー・未キャッシュの作品（annictWorkIds に列挙） */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            annictWorkIds?: number[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 作品リストが見つからない（他人のリストを含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/work-lists/{id}/share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 作品リストを共有する（共有トークンを発行。発行済みなら同じものを返す） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 共有トークン */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            shareToken: string;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 作品リストが見つからない（他人のリストを含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** 作品リストの共有をやめる（共有トークンを失効） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 共有をやめた */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 作品リストが見つからない（他人のリストを含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/work-lists/public": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開されている作品リストの一覧を取得する */
        get: {
            parameters: {
                query?: {
                    sort?: "likes" | "new";
                    cursor?: string;
                    limit?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 公開リストの 1 ページ */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: number;
                                title: string;
                                description: string | null;
                                createdAt: string;
                                owner: {
                                    userId: string;
                                    username: string;
                                    profileImageUrl: string | null;
                                };
                                itemCount: number;
                                likeCount: number;
                                likedByMe: boolean;
                                thumbnails: {
                                    annictWorkId: number;
                                    title: string;
                                    hostedImageUrl: string | null;
                                }[];
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/work-lists/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開されている作品リストの詳細を取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 公開リストと内容 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: number;
                            title: string;
                            description: string | null;
                            createdAt: string;
                            owner: {
                                userId: string;
                                username: string;
                                profileImageUrl: string | null;
                            };
                            itemCount: number;
                            likeCount: number;
                            likedByMe: boolean;
                            items: {
                                annictWorkId: number;
                                position: number;
                                title: string;
                                titleKana: string | null;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                imageUrl: string | null;
                                resolvedImageUrl: string | null;
                                imageSource: string | null;
                                imageR2Key: string | null;
                                watchersCount: number | null;
                                hostedImageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 公開リストが見つからない（非公開・ブロック関係を含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/work-lists/{id}/like": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 公開リストにいいねする */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description いいね後の件数と自分の状態 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            likeCount: number;
                            likedByMe: boolean;
                        };
                    };
                };
                /** @description 入力エラー・自分のリスト */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 公開リストが見つからない（非公開・ブロック関係を含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description レート制限 */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** 公開リストへのいいねを取り消す */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description いいね後の件数と自分の状態 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            likeCount: number;
                            likedByMe: boolean;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 公開リストが見つからない（非公開・ブロック関係を含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description レート制限 */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/work-lists/{id}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 公開リストを通報する */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: number;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        reason: string;
                    };
                };
            };
            responses: {
                /** @description 通報を受け付けた */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 入力エラー・自分のリスト */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 公開リストが見つからない（非公開・ブロック関係を含む） */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 通報の回数制限（Retry-After ヘッダ付き） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            code?: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/user/{uid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 公開名刺を取得する（Accept で JSON / OGP HTML を出し分け）
         * @description 認証は任意。サインイン済みならブロック関係にある相手を 404 にする。
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    uid: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 公開名刺 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            username: string;
                            bio: string | null;
                            favoriteQuote: string | null;
                            profileImageUrl: string | null;
                            meishiSnapshotUrl: string | null;
                            genres: string[];
                            socialLinks: {
                                /** @enum {string} */
                                kind: "x" | "pixiv" | "fanbox" | "dlsite" | "dmm" | "youtube" | "other";
                                value: string;
                                /** @enum {string} */
                                visibility: "public" | "friends" | "private";
                                url: string;
                            }[];
                            watchSummary: {
                                watchedCount: number;
                                watchingCount: number;
                                wannaWatchCount: number;
                                favoriteCount: number;
                                favoriteTitles: string[];
                                syncedAt: string | null;
                            };
                            nowWatching: {
                                annictWorkId: number;
                                annictEpisodeId: number;
                                title: string;
                                titleEn: string | null;
                                seasonName: string | null;
                                seasonYear: number | null;
                                hostedImageUrl: string | null;
                                recordedAt: string;
                            } | null;
                        };
                        "text/html": string;
                    };
                };
                /** @description 存在しない・非公開・ブロック関係にある */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                        "text/html": string;
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** ユーザーを通報する */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        reason: string;
                    };
                };
            };
            responses: {
                /** @description 通報を記録した */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 自分自身への通報・入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 対象ユーザーが存在しない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 通報レート制限（Retry-After ヘッダ付き） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                            /** @enum {string} */
                            code: "duplicate_target" | "hourly_limit" | "rate_limited";
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/block": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** ユーザーをブロックする（冪等） */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description ブロックした */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 自分自身へのブロック */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 対象ユーザーが存在しない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        /** ユーザーのブロックを解除する（冪等） */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description ブロックを解除した */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 自分自身へのブロック解除 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/common": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** フレンドと共有する視聴記録と推しを取得する */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 共通点。共通点が無ければ相手の今期視聴中を返す */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            watchingTogether: {
                                annictWorkId: number;
                                title: string;
                                hostedImageUrl: string | null;
                            }[];
                            watchedTogetherCount: number;
                            favoriteTogether: {
                                annictWorkId: number;
                                title: string;
                                hostedImageUrl: string | null;
                            }[];
                            conversationStarters: {
                                annictWorkId: number;
                                title: string;
                                hostedImageUrl: string | null;
                            }[];
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description フレンドではない、またはブロック関係 */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/public": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 公開名刺の一覧を取得する */
        get: {
            parameters: {
                query?: {
                    sort?: "likes" | "new";
                    cursor?: string;
                    limit?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description 公開名刺の 1 ページ */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                username: string;
                                profileImageUrl: string | null;
                                bio: string | null;
                                favoriteQuote: string | null;
                                genres: string[];
                                likeCount: number;
                                likedByMe: boolean;
                                createdAt: string;
                                meishiSnapshotUrl: string | null;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/like": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 公開名刺にいいねする */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description いいね後の件数と自分の状態 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            likeCount: number;
                            likedByMe: boolean;
                        };
                    };
                };
                /** @description 入力エラー・自分の名刺 */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 公開ユーザーが見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description レート制限 */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        post?: never;
        /** 公開名刺へのいいねを取り消す */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description いいね後の件数と自分の状態 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            likeCount: number;
                            likedByMe: boolean;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 公開ユーザーが見つからない */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description レート制限 */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 不具合報告・ご意見を送る */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        category: "bug" | "request" | "other";
                        body: string;
                        appVersion?: string;
                        platform?: string;
                    };
                };
            };
            responses: {
                /** @description 受け付けた */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            success: boolean;
                        };
                    };
                };
                /** @description 入力エラー */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 未認証 */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
                /** @description 送信回数の上限（Retry-After ヘッダ付き） */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
