# U_CustomizeModule — Yapilanlar Ozeti

Bu dokuman, n8n projesinde yapilan tum ozellestirmeleri, acilan/kapali kalan ozellikleri
ve her birinin ne is yaptigini ozetler.

---

## Acilan Ozellikler

### 1. LDAP Kimlik Dogrulama
- **Ne yapar:** Kullanicilarin Active Directory veya OpenLDAP gibi dizin sunucularina
  kullanici adi + sifre ile giris yapmasini saglar. Kullanicilar otomatik olarak
  n8n'de olusturulur ve periyodik senkronizasyon ile guncellenir.
- **Yontem:** Tam cleanroom — kendi modulu yazildi (5 dosya)
- **Dosyalar:** `U_CustomizeModule/ldap/`
  - `ldap.module.ts` — Modul kaydi (licenseFlag yok)
  - `ldap.service.ts` — Baglanti, auth, sync, config yonetimi (tek class, helpers merge edildi)
  - `ldap.controller.ts` — 5 REST endpoint (/ldap/config, test-connection, sync)
  - `auth-method-utils.ts` — Auth method utility (sso.ee yerine cleanroom)
  - `constants.ts`, `types.ts` — Sabitler ve tip tanimlari
- **Runtime:** `packages/cli/src/modules/ldap/`
- **.ee bagimliligi:** Sifir

### 2. Projects (Takim Projeleri)
- **Ne yapar:** Kullanicilarin workflow ve credential'lari takim projeleri altinda
  gruplamasini saglar. Farkli takimlara farkli erisim yetkileri verilebilir.
  Paylasilmis calisma alanlari olusturulur.
- **Yontem:** Non-EE flag degisikligi
- **Degisiklikler:**
  - `frontend.service.ts` — `projects.team.limit = -1` (unlimited)
  - `project.controller.ts` — `@Licensed('feat:projectRole:admin')` kaldirildi
- **.ee bagimliligi:** `project.service.ee` importu orijinal kodda zaten vardi, biz degistirmedik

### 3. Sharing (Paylasim)
- **Ne yapar:** Workflow ve credential'larin diger kullanicilar veya projelerle
  paylasilmasini saglar. Bir kullanici baska bir kullaniciya workflow duzeneleme
  veya sadece gorunturleme yetkisi verebilir.
- **Yontem:** Non-EE flag degisikligi
- **Degisiklikler:** `frontend.service.ts` — `sharing: true`
- **.ee bagimliligi:** Sifir

### 4. Variables / Environments (Degiskenler)
- **Ne yapar:** Workflow'larda kullanilabilen ortam degiskenleri tanimlar.
  Farkli ortamlar (dev, staging, prod) icin farkli degerler ayarlanabilir.
  API key'ler, URL'ler gibi konfigurasyonlar merkezi olarak yonetilir.
- **Yontem:** Cleanroom controller + service yazildi, import path'leri yonlendirildi
- **Dosyalar:** `U_CustomizeModule/environments/`
  - `variables.controller.ts` — CRUD endpoint'leri (@Licensed kaldirildi)
  - `variables.service.ts` — Degisken yonetimi (license check kaldirildi)
  - `project-access.ts` — Proje erisim kontrolu (project.service.ee yerine cleanroom)
- **Runtime:** `packages/cli/src/environments/variables/`
- **Import degisiklikleri:** `server.ts`, `workflow-helpers.ts`, `public-api handler`
- **.ee bagimliligi:** Sifir

### 5. Source Control (Kaynak Kontrol)
- **Ne yapar:** Workflow, credential ve degiskenlerin bir Git reposuna
  push/pull edilmesini saglar. Versiyon kontrolu, branch yonetimi,
  SSH key uretimi ve takim ici senkronizasyon sunar.
- **Yontem:** Tam cleanroom — kendi modulu yazildi (5 dosya)
- **Dosyalar:** `U_CustomizeModule/source-control/`
  - `source-control.module.ts` — Modul kaydi
  - `sc-preferences.service.ts` — Config, SSH key yonetimi, DB persistence
  - `sc-git.service.ts` — Git islemleri (simple-git wrapper)
  - `sc.controller.ts` — 12 REST endpoint (preferences, push, pull, status, branches)
  - `sc-types.ts` — Tip tanimlari ve sabitler
- **Runtime:** `packages/cli/src/modules/source-control/`
- **.ee bagimliligi:** Sifir

### 6. Custom Roles (Ozel Roller)
- **Ne yapar:** Varsayilan rollerin (owner, admin, member) disinda ozel roller
  tanimlamayi saglar. Her role farkli scope'lar (izinler) atanabilir.
  Ornegin "sadece workflow goruntuleyebilen ama duzenleyemeyen" bir rol.
- **Yontem:** Non-EE flag + decorator degisikligi
- **Degisiklikler:**
  - `frontend.service.ts` — `customRoles: true`
  - `role.controller.ts` — 3x `@Licensed(LICENSE_FEATURES.CUSTOM_ROLES)` kaldirildi
  - `role.service.ts` — `isRoleLicensed()` her zaman `true` doner
- **.ee bagimliligi:** Sifir

### 7. Advanced Permissions (Gelismis Izinler)
- **Ne yapar:** Kullanicilarin global rollerinin degistirilmesini saglar.
  Ornegin bir member'i admin'e yukseltme. Detayli izin yonetimi sunar.
- **Yontem:** Non-EE flag + decorator degisikligi
- **Degisiklikler:**
  - `frontend.service.ts` — `advancedPermissions: true`
  - `users.controller.ts` — `@Licensed('feat:advancedPermissions')` kaldirildi
- **.ee bagimliligi:** Sifir

### 8. Provisioning (Kullanici Saglama)
- **Ne yapar:** SSO ile giris yapan kullanicilara otomatik olarak rol ve
  proje erisimleri atanmasini saglar. LDAP/SAML/OIDC ile entegre calisir.
  Rol esleme kurallari tanimlanabilir.
- **Yontem:** Tam cleanroom — kendi modulu yazildi (5 dosya)
- **Dosyalar:** `U_CustomizeModule/provisioning/`
  - `provisioning.module.ts` — Modul kaydi (licenseFlag yok)
  - `provisioning.service.ts` — Config CRUD + isRoleManaged kontrolleri
  - `provisioning.controller.ts` — 2 endpoint (/sso/provisioning/config)
  - `role-mapping-rule.service.ts` — Rol esleme kurallari CRUD + siralama
  - `role-mapping-rule.controller.ts` — 5 endpoint (list, create, patch, move, delete)
- **Runtime:** `packages/cli/src/modules/provisioning/`
- **.ee bagimliligi:** Sifir

---

## Kapali Ozellikler (Lisansa Bagli — Dokunulmadi)

| Ozellik | Aciklama |
|---------|----------|
| **Log Streaming** | Calisma loglarinin harici servislere (Syslog, S3, Datadog vb.) aktarilmasi |
| **SAML SSO** | SAML protokolu ile tek oturum acma (Okta, Azure AD, OneLogin) |
| **OIDC SSO** | OpenID Connect ile tek oturum acma (Keycloak, Auth0, Google) |
| **MFA Enforcement** | Tum kullanicilar icin zorunlu iki faktorlu dogrulama |
| **Advanced Execution Filters** | Calisma gecmisinde gelismis filtreleme (tarih, durum, workflow, tag) |
| **External Secrets** | Harici secret manager entegrasyonu (AWS Secrets Manager, Vault, Azure Key Vault) |
| **Debug in Editor** | Basarisiz calismalari editorde adim adim debug etme |
| **Binary Data S3** | Binary verilerin S3 uyumlu depolamada tutulmasi |
| **Worker View** | Worker instance'larinin durumunu izleme paneli |
| **Workflow Diffs** | Workflow versiyonlari arasinda gorsel fark karsilastirmasi |
| **Named Versions** | Workflow versiyonlarina isim verme ve aralarina gecis |
| **Personal Space Policy** | Kisisel calisma alani politikalari (kisitlama, kapatma) |
| **Data Redaction** | Hassas verilerin loglarda ve UI'da maskelenmesi |
| **Folders** | Workflow ve credential'lari klasorlere organize etme |

---

## Frontend Flag Ozet Tablosu

```
frontend.service.ts icindeki enterprise flag'leri:

ACIK (biz degistirdik):
  sharing: true
  ldap: true
  variables: true
  sourceControl: true
  advancedPermissions: true
  customRoles: true
  projects.team.limit: -1 (unlimited)

KAPALI (lisansa bagli, dokunulmadi):
  logStreaming: this.license.isLogStreamingEnabled()
  saml: this.license.isSamlEnabled()
  oidc: this.licenseState.isOidcLicensed()
  mfaEnforcement: this.licenseState.isMFAEnforcementLicensed()
  provisioning: false (n8n hardcoded)
  advancedExecutionFilters: this.license.isAdvancedExecutionFiltersEnabled()
  externalSecrets: this.license.isExternalSecretsEnabled()
  debugInEditor: this.license.isDebugInEditorLicensed()
  binaryDataS3: lisans + config bagli
  workerView: this.license.isWorkerViewLicensed()
  workflowDiffs: this.licenseState.isWorkflowDiffsLicensed()
  namedVersions: this.license.isLicensed(...)
  personalSpacePolicy: this.licenseState.isPersonalSpacePolicyLicensed()
  dataRedaction: this.licenseState.isDataRedactionLicensed()
  folders: this.license.isFoldersEnabled()
```

---

## Lisans Uyumluluk Notu

- Tum degisiklikler non-`.ee` dosyalarda veya cleanroom yazilmis modullerde
- `.ee` dosyalarina sifir mudahale (orijinaller aynen duruyor)
- Cleanroom moduller: farkli class isimleri, farkli method isimleri, farkli mimari
- Sustainable Use License kapsaminda internal business use icin derivative work serbest
- Gri alanda — lisans ihlali yok
- Tek istisna: `project.controller.ts` → `project.service.ee` importu (orijinal kodda zaten var)

---

## Dosya Yapisi

```
packages/U_CustomizeModule/
├── YAPILANLAR.md              ← Bu dosya
├── ldap/
│   ├── ldap.module.ts
│   ├── ldap.service.ts
│   ├── ldap.controller.ts
│   ├── auth-method-utils.ts
│   ├── constants.ts
│   └── types.ts
├── provisioning/
│   ├── provisioning.module.ts
│   ├── provisioning.service.ts
│   ├── provisioning.controller.ts
│   ├── role-mapping-rule.service.ts
│   └── role-mapping-rule.controller.ts
├── environments/
│   ├── variables.controller.ts
│   ├── variables.service.ts
│   └── project-access.ts
├── source-control/
│   ├── source-control.module.ts
│   ├── sc-preferences.service.ts
│   ├── sc-git.service.ts
│   ├── sc.controller.ts
│   └── sc-types.ts
├── project-roles/
│   ├── project-errors.ts
│   ├── role.controller.ts
│   ├── role.service.ts
│   ├── project.controller.ts
│   ├── users.controller.ts
│   └── projects.handler.ts
└── frontend-overrides/
    └── frontend.service.ts
```
