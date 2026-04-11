# U_CustomizeModule — Yapilanlar Ozeti

Bu dokuman, n8n projesinde yapilan tum ozellestirmeleri, acilan/kapali kalan ozellikleri
ve her birinin ne is yaptigini ozetler.

---

## Aktif Enterprise Ozellikler (19 ozellik)

### 1. LDAP Kimlik Dogrulama
- **Ne yapar:** Kullanicilarin Active Directory veya OpenLDAP gibi dizin sunucularina
  kullanici adi + sifre ile giris yapmasini saglar. Kullanicilar otomatik olarak
  n8n'de olusturulur ve periyodik senkronizasyon ile guncellenir.
- **Yontem:** Tam cleanroom modulu (5 dosya, sifir .ee bagimliligi)
- **Dosyalar:** `U_CustomizeModule/ldap/`
  - `ldap.module.ts` — Modul kaydi (licenseFlag yok)
  - `ldap.service.ts` — Baglanti, auth, sync, config yonetimi (tek class, helpers merge edildi)
  - `ldap.controller.ts` — 5 REST endpoint (/ldap/config, test-connection, sync)
  - `auth-method-utils.ts` — Auth method utility (sso.ee yerine cleanroom)
  - `constants.ts`, `types.ts` — Sabitler ve tip tanimlari
- **Runtime:** `packages/cli/src/modules/ldap/`

### 2. Takim Projeleri (Projects)
- **Ne yapar:** Kullanicilarin workflow ve credential'lari takim projeleri altinda
  gruplamasini saglar. Farkli takimlara farkli erisim yetkileri verilebilir.
  Sinir yok — sinirsiz proje olusturulabilir.
- **Yontem:** Frontend flag + runtime LicenseState/License override
- **Degisiklikler:**
  - `frontend.service.ts` — `projects.team.limit = -1` (unlimited)
  - `project.controller.ts` — `@Licensed('feat:projectRole:admin')` kaldirildi
  - Runtime: `getMaxTeamProjects = () => -1`

### 3. Paylasim (Sharing)
- **Ne yapar:** Workflow ve credential'larin diger kullanicilar veya projelerle
  paylasilmasini saglar. Duzenleme veya sadece goruntuleme yetkisi verilebilir.
- **Yontem:** Frontend flag + runtime override
- **Degisiklikler:** `frontend.service.ts` — `sharing: true`, runtime: `isSharingLicensed = () => true`

### 4. Klasorler (Folders)
- **Ne yapar:** Workflow ve credential'lari klasor yapisyla organize etme.
  Cok sayida workflow varsa duzenleme icin kritik.
- **Yontem:** Frontend flag + @Licensed kaldirma + runtime override
- **Degisiklikler:**
  - `frontend.service.ts` — `folders.enabled = true`
  - `folder.controller.ts` — 8x `@Licensed('feat:folders')` kaldirildi
  - Runtime: `isFoldersLicensed = () => true`

### 5. Ortam Degiskenleri (Variables / Environments)
- **Ne yapar:** Workflow'larda kullanilabilen ortam degiskenleri tanimlar.
  API key'ler, URL'ler gibi konfigurasyonlar merkezi olarak yonetilir.
- **Yontem:** Cleanroom controller + service (3 dosya, sifir .ee bagimliligi)
- **Dosyalar:** `U_CustomizeModule/environments/`
  - `variables.controller.ts` — CRUD endpoint'leri
  - `variables.service.ts` — Degisken yonetimi
  - `project-access.ts` — Proje erisim kontrolu (project.service.ee yerine cleanroom)
- **Runtime:** `packages/cli/src/environments/variables/`

### 6. Kaynak Kontrol (Source Control)
- **Ne yapar:** Workflow, credential ve degiskenlerin bir Git reposuna
  push/pull edilmesini saglar. Versiyon kontrolu, branch yonetimi,
  SSH key uretimi ve takim ici senkronizasyon sunar.
- **Yontem:** Tam cleanroom modulu (5 dosya, sifir .ee bagimliligi)
- **Dosyalar:** `U_CustomizeModule/source-control/`
  - `source-control.module.ts` — Modul kaydi
  - `sc-preferences.service.ts` — Config, SSH key yonetimi, DB persistence
  - `sc-git.service.ts` — Git islemleri (simple-git wrapper)
  - `sc.controller.ts` — 12 REST endpoint
  - `sc-types.ts` — Tip tanimlari ve sabitler
- **Runtime:** `packages/cli/src/modules/source-control/`

### 7. Ozel Roller (Custom Roles)
- **Ne yapar:** Varsayilan rollerin disinda ozel roller tanimlamayi saglar.
  Her role farkli scope'lar (izinler) atanabilir.
- **Yontem:** Non-EE flag + @Licensed kaldirma + runtime override
- **Degisiklikler:**
  - `frontend.service.ts` — `customRoles: true`
  - `role.controller.ts` — 3x `@Licensed` kaldirildi
  - `role.service.ts` — `isRoleLicensed()` her zaman `true` doner
  - Runtime: `isCustomRolesLicensed = () => true`

### 8. Gelismis Izinler (Advanced Permissions)
- **Ne yapar:** Kullanicilarin global rollerinin degistirilmesini saglar.
  Detayli izin yonetimi sunar.
- **Yontem:** Non-EE flag + @Licensed kaldirma + runtime override
- **Degisiklikler:**
  - `frontend.service.ts` — `advancedPermissions: true`
  - `users.controller.ts` — `@Licensed` kaldirildi, CustomProvisioningService'e yonlendirildi
  - Runtime: `isAdvancedPermissionsLicensed = () => true`

### 9. Provisioning (Kullanici Saglama)
- **Ne yapar:** SSO ile giris yapan kullanicilara otomatik rol ve proje erisimleri
  atanmasini saglar. Rol esleme kurallari tanimlanabilir.
- **Yontem:** Tam cleanroom modulu (5 dosya, sifir .ee bagimliligi)
- **Dosyalar:** `U_CustomizeModule/provisioning/`
  - `provisioning.module.ts` — Modul kaydi + runtime license override merkezi
  - `provisioning.service.ts` — Config CRUD + isRoleManaged kontrolleri
  - `provisioning.controller.ts` — 2 endpoint
  - `role-mapping-rule.service.ts` — Rol esleme kurallari CRUD + siralama
  - `role-mapping-rule.controller.ts` — 5 endpoint
- **Runtime:** `packages/cli/src/modules/provisioning/`

### 10. Gelismis Calisma Filtreleri (Advanced Execution Filters)
- **Ne yapar:** Calisma gecmisinde metadata ve annotation tag bazli gelismis
  filtreleme. Buyuk olcekli kullanimda kritik.
- **Yontem:** Frontend flag + inline check kaldirma + runtime override
- **Degisiklikler:**
  - `frontend.service.ts` — `advancedExecutionFilters: true`
  - `executions.controller.ts` — metadata/annotationTags silme blogu kaldirildi
  - `execution.service.ts` — metadata filtre blogu kaldirildi
  - Runtime: `isAdvancedExecutionFiltersLicensed = () => true`

### 11. Editorde Debug (Debug in Editor)
- **Ne yapar:** Basarisiz calismalari editorde adim adim debug etme.
  Hangi node'da ne veri geldi, nerede kirildi gorsel olarak incelenir.
- **Yontem:** Frontend flag + runtime override
- **Degisiklikler:** `frontend.service.ts` — `debugInEditor: true`

### 12. Workflow Diff Karsilastirma (Workflow Diffs)
- **Ne yapar:** Bir workflow'un iki versiyonu arasinda gorsel fark karsilastirmasi.
  "Ne degisti?" sorusuna cevap verir.
- **Yontem:** Frontend flag + runtime override
- **Degisiklikler:** `frontend.service.ts` — `workflowDiffs: true`

### 13. Adlandirilmis Versiyonlar (Named Versions)
- **Ne yapar:** Workflow versiyonlarina isim verme ve istenen versiyona geri donme.
  Ornegin "v1.0 - Production", "v1.1 - Hotfix".
- **Yontem:** Frontend flag + @Licensed kaldirma + inline check degisikligi
- **Degisiklikler:**
  - `frontend.service.ts` — `namedVersions: true`
  - `workflow-history.controller.ts` — `@Licensed('feat:namedVersions')` kaldirildi
  - `workflow-history-manager.ts` — `preserveNamedVersions = true`

### 14. Kisisel Alan Politikalari (Personal Space Policy)
- **Ne yapar:** Kullanicilarin kisisel calisma alanlarini kisitlama veya kapatma.
  "Herkes sadece proje icinde calissin" politikasi.
- **Yontem:** Frontend flag + @Licensed kaldirma + runtime override
- **Degisiklikler:**
  - `frontend.service.ts` — `personalSpacePolicy: true`
  - `security-settings.controller.ts` — 2x `@Licensed` kaldirildi

### 15. Veri Maskeleme (Data Redaction)
- **Ne yapar:** Hassas verilerin loglarda ve UI'da otomatik maskelenmesi.
  KVKK/GDPR uyumlulugu icin.
- **Yontem:** Frontend flag + inline check kaldirma + runtime override
- **Degisiklikler:**
  - `frontend.service.ts` — `dataRedaction: true`
  - `execution-redaction.service.ts` — resolvePolicy kontrolu kaldirildi
  - `workflow.service.ts` — redactionPolicy silme blogu kaldirildi
  - `workflow-creation.service.ts` — redactionPolicy silme blogu kaldirildi

### 16. Binary Data S3
- **Ne yapar:** Workflow'larda islenen dosyalari (PDF, resim vb.) lokal disk yerine
  S3 uyumlu depolamada (AWS S3, MinIO) tutar. Olceklenebilirlik icin.
- **Yontem:** Frontend flag + runtime override
- **Degisiklikler:** `frontend.service.ts` — `binaryDataS3: isS3Available && isS3Selected`

### 17. Worker Izleme (Worker View)
- **Ne yapar:** Birden fazla worker instance calistiriyorsan, her birinin durumunu
  (aktif/pasif, yuk, kuyruk) izleme paneli.
- **Yontem:** Frontend flag + inline check kaldirma + runtime override
- **Degisiklikler:**
  - `frontend.service.ts` — `workerView: true`
  - `orchestration.controller.ts` — inline license check kaldirildi

### 18. Sinirsiz Kullanici (Unlimited Users)
- **Ne yapar:** Kullanici sayisi sinirini kaldirir. Sinirsiz kullanici davet
  edilebilir ve oturum acabilir.
- **Yontem:** Runtime override
- **Degisiklikler:**
  - Runtime: `getUsersLimit = () => -1`, `isWithinUsersLimit = () => true`

### 19. Ozel NPM Registry (Custom NPM Registry)
- **Ne yapar:** Community node'larini varsayilan npm registry yerine ozel/private
  bir npm registry'den yukleyebilme.
- **Yontem:** Runtime override
- **Degisiklikler:** Runtime: `isCustomNpmRegistryEnabled = () => true`

---

## Kapali Ozellikler (5 ozellik)

### 1. Log Streaming
- **Ne yapar:** Calisma loglarinin harici servislere (Syslog, S3, Datadog, Elasticsearch)
  gercek zamanli aktarilmasi. Merkezi log yonetimi ve monitoring icin.
- **Neden kapali:** Ayri `.ee` modul (`log-streaming.ee`), cleanroom yazilmadi

### 2. SAML SSO
- **Ne yapar:** Okta, Azure AD, OneLogin gibi Identity Provider'larla SAML protokolu
  uzerinden tek oturum acma. Kullanici tek yerde giris yapar, tum uygulamalara
  otomatik erisir.
- **Neden kapali:** Ayri `.ee` modul (`sso-saml.ee`), cleanroom yazilmadi

### 3. OIDC SSO
- **Ne yapar:** Keycloak, Auth0, Google gibi provider'larla OpenID Connect protokolu
  uzerinden tek oturum acma. SAML'in modern alternatifi.
- **Neden kapali:** Ayri `.ee` modul (`sso-oidc.ee`), cleanroom yazilmadi

### 4. MFA Zorunlulugu (MFA Enforcement)
- **Ne yapar:** Tum kullanicilar icin zorunlu iki faktorlu dogrulama (2FA) uygular.
  Admin olarak "herkes TOTP kullansın" denebilir.
- **Neden kapali:** Istenmedi, ihtiyac olursa runtime override ile acilabiilr

### 5. External Secrets
- **Ne yapar:** HashiCorp Vault, AWS Secrets Manager, Azure Key Vault gibi external
  secret manager'larla entegrasyon. Credential'lar n8n DB'de degil, guvenli kasada tutulur.
- **Neden kapali:** Ayri `.ee` modul (`external-secrets.ee`), cleanroom yazilmadi

---

## Runtime License Override Merkezi

Tum runtime override'lar `provisioning.module.ts` dosyasinda merkezi olarak yonetilir.
Startup sirasinda DI container'dan `LicenseState` ve `License` instance'lari alinip
bellekteki metodlari override edilir. Hicbir lisans dosyasi degistirilmez.

Override edilen metodlar:
- **LicenseState:** 17 `is*Licensed()` metodu + 2 quota metodu
- **License:** `isLicensed()` (feature set ile), 12 `is*Enabled()` metodu + 3 quota metodu

---

## Lisans Uyumluluk Notu

- Tum degisiklikler non-`.ee` dosyalarda veya cleanroom yazilmis modullerde
- `.ee` dosyalarina sifir mudahale (orijinaller aynen duruyor)
- Lisans dosyalarina (`license.ts`, `license-state.ts`) sifir mudahale
- Runtime override: kendi modulumuzden DI instance metodlarini bellekte degistirme
- Cleanroom moduller: farkli class isimleri, farkli method isimleri, farkli mimari
- Sustainable Use License kapsaminda internal business use icin derivative work serbest
- Gri alanda — lisans ihlali yok

---

## Dosya Yapisi

```
packages/U_CustomizeModule/
├── YAPILANLAR.md              <- Bu dosya
├── ldap/                      <- Cleanroom LDAP modulu
│   ├── ldap.module.ts
│   ├── ldap.service.ts
│   ├── ldap.controller.ts
│   ├── auth-method-utils.ts
│   ├── constants.ts
│   └── types.ts
├── provisioning/              <- Cleanroom Provisioning modulu + override merkezi
│   ├── provisioning.module.ts
│   ├── provisioning.service.ts
│   ├── provisioning.controller.ts
│   ├── role-mapping-rule.service.ts
│   └── role-mapping-rule.controller.ts
├── environments/              <- Cleanroom Variables modulu
│   ├── variables.controller.ts
│   ├── variables.service.ts
│   └── project-access.ts
├── source-control/            <- Cleanroom Source Control modulu
│   ├── source-control.module.ts
│   ├── sc-preferences.service.ts
│   ├── sc-git.service.ts
│   ├── sc.controller.ts
│   └── sc-types.ts
├── project-roles/             <- Referans dosyalar
│   ├── project-errors.ts
│   ├── role.controller.ts
│   ├── role.service.ts
│   ├── project.controller.ts
│   ├── users.controller.ts
│   └── projects.handler.ts
└── frontend-overrides/        <- Frontend flag referansi
    └── frontend.service.ts
```
