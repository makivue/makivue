import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('profile page', () => {
    const page = source('src/app/profile/page.tsx')
    const rootLayout = source('src/app/layout.tsx')
    const siteHeader = source('src/components/SiteHeader.tsx')
    const layout = source('src/app/profile/layout.tsx')
    const metadata = source('src/i18n/metadata.ts')
    const authBar = source('src/components/AuthBar.tsx')
    const route = source('src/app/api/profile/route.ts')
    const migration = source('prisma/migrations/20260901_add_user_profiles/migration.sql')
    const identityMigration = source('prisma/migrations/20260917184000_add_user_identities/migration.sql')

    it('shows the current user identity from the existing auth session', () => {
        expect(page).toContain('useSyncExternalStore(onAuthChange, getAuthSessionSnapshot')
        expect(page).toContain('user.photoURL')
        expect(page).toContain('user.displayName')
        expect(page).toContain('user.email')
        expect(page).toContain('user.userId')
        expect(page).toContain("user.isAdmin ? '管理员' : '普通用户'")
    })

    it('is accessible from the account menu and keeps locale navigation available', () => {
        expect(authBar).toContain('href="/profile"')
        expect(authBar).toContain('个人中心')
        expect(page).not.toContain('<LanguageSwitcher')
        expect(rootLayout).not.toContain('<GlobalLanguageSwitcher />')
        expect(siteHeader).toContain('<GlobalPreferences />')
        expect(page).toContain('href="/projects"')
        expect(page).toContain('href="/wallet"')
        expect(page).toContain('href="/settings"')
    })

    it('loads and displays the remaining points without blocking profile data', () => {
        expect(page).toContain("clientFetch('/api/wallet/balance')")
        expect(page).toContain('wallet?.balancePoints')
        expect(page).toContain('剩余积分')
        expect(page).toContain('积分与充值')
        expect(page).toContain('.catch(() =>')
    })

    it('lets authenticated users edit a required nickname and upload a required avatar', () => {
        expect(page).toContain("clientFetch('/api/profile'")
        expect(page).toContain("form.set('displayName'")
        expect(page).toContain("form.set('avatar'")
        expect(page).toContain('disabled={!canSubmitProfile}')
        expect(page).toContain('头像和昵称均为必填项')
        expect(page).toContain('编辑资料')
    })

    it('persists only authenticated, validated profiles and uploads avatar files to local storage', () => {
        expect(route).toContain('currentUserId(req)')
        expect(route).toContain("return apiError('请输入昵称')")
        expect(route).toContain("return apiError('请上传头像')")
        expect(route).toContain('PROFILE_AVATAR_MAX_BYTES')
        expect(route).toContain('saveLocalMediaFile')
        expect(route).toContain('prisma.userProfile.upsert')
        expect(migration).toContain('CREATE TABLE `user_profiles`')
        expect(migration).toContain('`display_name` VARCHAR(80) NOT NULL')
        expect(migration).toContain('`avatar_url` VARCHAR(1024) NOT NULL')
    })

    it('falls back to the Google identity snapshot before a custom profile is saved', () => {
        expect(route).toContain('prisma.userIdentity.findUnique')
        expect(route).toContain('profile?.displayName ?? identity?.displayName')
        expect(route).toContain('profile?.avatarUrl ?? identity?.avatarUrl')
        expect(identityMigration).toContain('CREATE TABLE `user_identities`')
        expect(identityMigration).toContain('`email` VARCHAR(255) NOT NULL')
    })

    it('keeps the private profile route out of search indexes', () => {
        expect(layout).toContain("localizedPrivateMetadata('个人中心'")
        expect(metadata).toContain('robots: { index: false, follow: false }')
    })
})
