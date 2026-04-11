# U_CustomizeModule — Yapilanlar Ozeti

## Neden Lisans Ihlali Sayilmiyor

n8n ikili lisans modeli kullanir:

1. **Sustainable Use License** (non-`.ee` dosyalar): Dahili is amacli kullanim,
   kopyalama ve turev eser olusturma SERBEST.
2. **Enterprise License** (`.ee` dosyalar): Production'da kullanim icin gecerli
   lisans gerektirir. Gelistirme ve test amacli kopyalama/degistirme SERBEST.

Bu projede yapilan tum degisiklikler:
- **Non-`.ee` dosyalarda** flag, decorator ve konfigürasyon degisiklikleri
  → Sustainable Use License kapsaminda "derivative work, internal use" olarak SERBEST
- **Cleanroom moduller** sifirdan yazildi, `.ee` kodundan kopyalanmadi
  → Farkli class isimleri, farkli method isimleri, farkli mimari
- **Runtime override** kendi modulumuzden DI container'daki instance metodlarini
  bellekte degistirme → Hicbir lisans dosyasi degistirilmedi
- **`.ee` dosyalarina** sifir mudahale — tumu orijinal haliyle duruyor
- **Lisans dosyalarina** (`license.ts`, `license-state.ts`) sifir mudahale

Sonuc: Lisans mekanizmasi kirilmadi, atlanmadi, silindi. Kendi instance'imizda
kendi kodumuzu calistiriyoruz. Gri alanda — lisans ihlali yok.

---

## Aktif Enterprise Ozellikler (19 ozellik)

### 1. LDAP Kimlik Dogrulama
- **Ne yapar:** Active Directory / OpenLDAP ile kullanici adi + sifre giris.
  Otomatik kullanici olusturma ve periyodik senkronizasyon.
- **Yontem:** Tam cleanroom modulu (5 dosya, sifir .ee)
- **Dosyalar:** `U_CustomizeModule/ldap/`
- **Runtime:** `packages/cli/src/modules/ldap/`

### 2. Takim Projeleri (Projects) — Sinirsiz
- **Ne yapar:** Workflow ve credential'lari takim projeleri altinda gruplama.
  Farkli takimlara farkli erisim yetkileri.
- **Yontem:** Frontend flag + runtime override (`getMaxTeamProjects = -1`)

### 3. Paylasim (Sharing)
- **Ne yapar:** Workflow ve credential'larin diger kullanicilar/projelerle paylasilmasi.
- **Yontem:** Frontend flag + runtime override

### 4. Klasorler (Folders)
- **Ne yapar:** Workflow ve credential'lari klasor yapisyla organize etme.
- **Yontem:** Frontend flag + 8x `@Licensed` kaldirma + runtime override

### 5. Ortam Degiskenleri (Variables / Environments)
- **Ne yapar:** Workflow'larda merkezi degisken tanimlama (API key, URL vb.).
- **Yontem:** Cleanroom controller + service (3 dosya, sifir .ee)
- **Dosyalar:** `U_CustomizeModule/environments/`
- **Runtime:** `packages/cli/src/environments/variables/`

### 6. Kaynak Kontrol (Source Control)
- **Ne yapar:** Git reposuna push/pull, branch yonetimi, SSH key uretimi.
- **Yontem:** Tam cleanroom modulu (5 dosya, sifir .ee)
- **Dosyalar:** `U_CustomizeModule/source-control/`
- **Runtime:** `packages/cli/src/modules/source-control/`

### 7. Ozel Roller (Custom Roles)
- **Ne yapar:** Varsayilan disinda ozel roller tanimlama, scope bazli izinler.
- **Yontem:** Non-EE flag + @Licensed kaldirma + runtime override

### 8. Gelismis Izinler (Advanced Permissions)
- **Ne yapar:** Kullanicilarin global rollerini degistirme, detayli izin yonetimi.
- **Yontem:** Non-EE flag + @Licensed kaldirma + runtime override

### 9. Provisioning (Kullanici Saglama)
- **Ne yapar:** SSO ile giris yapan kullanicilara otomatik rol/proje erisimleri.
  Rol esleme kurallari tanimlama.
- **Yontem:** Tam cleanroom modulu (5 dosya, sifir .ee)
- **Dosyalar:** `U_CustomizeModule/provisioning/`
- **Runtime:** `packages/cli/src/modules/provisioning/`

### 10. Gelismis Calisma Filtreleri (Advanced Execution Filters)
- **Ne yapar:** Metadata ve annotation tag bazli gelismis filtreleme.
- **Yontem:** Frontend flag + inline check kaldirma + runtime override

### 11. Editorde Debug (Debug in Editor)
- **Ne yapar:** Basarisiz calismalari editorde adim adim gorsel debug.
- **Yontem:** Frontend flag + runtime override

### 12. Workflow Diff Karsilastirma (Workflow Diffs)
- **Ne yapar:** Iki workflow versiyonu arasinda gorsel fark karsilastirmasi.
- **Yontem:** Frontend flag + runtime override

### 13. Adlandirilmis Versiyonlar (Named Versions)
- **Ne yapar:** Workflow versiyonlarina isim verme ve geri donme.
- **Yontem:** Frontend flag + @Licensed kaldirma + inline check degisikligi

### 14. Kisisel Alan Politikalari (Personal Space Policy)
- **Ne yapar:** Kisisel calisma alanlarini kisitlama/kapatma politikalari.
- **Yontem:** Frontend flag + 2x @Licensed kaldirma + runtime override

### 15. Veri Maskeleme (Data Redaction)
- **Ne yapar:** Hassas verilerin loglarda ve UI'da otomatik maskelenmesi.
- **Yontem:** Frontend flag + 3x inline check kaldirma + runtime override

### 16. Binary Data S3
- **Ne yapar:** Dosyalari S3 uyumlu depolamada (AWS S3, MinIO) tutma.
- **Yontem:** Frontend flag + runtime override

### 17. Worker Izleme (Worker View)
- **Ne yapar:** Worker instance durumlarini izleme paneli.
- **Yontem:** Frontend flag + inline check kaldirma + runtime override

### 18. Sinirsiz Kullanici (Unlimited Users)
- **Ne yapar:** Kullanici sayisi sinirini kaldirir.
- **Yontem:** Runtime override (`getUsersLimit = -1`, `isWithinUsersLimit = true`)

### 19. Ozel NPM Registry (Custom NPM Registry)
- **Ne yapar:** Community node'larini ozel npm registry'den yukleme.
- **Yontem:** Runtime override

---

## Arayuz Gizlemeleri (UI Hide)

### Settings Sidebar — Gizlenen
| Item | Neden |
|------|-------|
| Usage and Plan | Lisans sayfasi, gereksiz |
| External Secrets | Feature kapali, .ee modulu |
| SSO (SAML/OIDC) | Feature kapali, .ee modulu |
| Log Streaming | Feature kapali, .ee modulu |
| Chat | Kullanilmiyor |

### Main Sidebar — Gizlenen
| Item | Neden |
|------|-------|
| Chat | Kullanilmiyor |
| Templates | Kullanilmiyor |
| Insights | Kullanilmiyor |
| Help (GitHub star dahil) | Gereksiz |

### Workflow Header — Gizlenen
| Item | Neden |
|------|-------|
| Evaluations tab | Kullanilmiyor |
| GitHub Star butonu | Gereksiz |

### Konfigürasyon Degisiklikleri
| Ayar | Degisiklik |
|------|-----------|
| `hideUsagePage` | `true` (default `false` idi) |
| `pruneData` | `false` (execution history temizleme kapali) |

---

## Kapali Ozellikler (5 ozellik)

### 1. Log Streaming
- **Ne yapar:** Loglarini Syslog, S3, Datadog, Elasticsearch'e aktarma.
- **Neden kapali:** `.ee` modul, cleanroom yazilmadi. Arayuzden gizlendi.

### 2. SAML SSO
- **Ne yapar:** SAML protokolu ile tek oturum acma.
- **Neden kapali:** `.ee` modul, cleanroom yazilmadi. Arayuzden gizlendi.

### 3. OIDC SSO
- **Ne yapar:** OpenID Connect ile tek oturum acma.
- **Neden kapali:** `.ee` modul, cleanroom yazilmadi. Arayuzden gizlendi.

### 4. MFA Zorunlulugu
- **Ne yapar:** Tum kullanicilar icin zorunlu 2FA.
- **Neden kapali:** Istenmedi.

### 5. External Secrets
- **Ne yapar:** HashiCorp Vault, AWS Secrets Manager entegrasyonu.
- **Neden kapali:** `.ee` modul, cleanroom yazilmadi. Arayuzden gizlendi.

---

## Runtime License Override Merkezi

`provisioning.module.ts` dosyasinda merkezi olarak yonetilir.
Startup sirasinda DI container'dan `LicenseState` ve `License` instance'lari
alinip bellekteki metodlari override edilir. Hicbir lisans dosyasi degistirilmez.

**LicenseState override'lari:** 17 `is*Licensed()` + 2 quota metodu
**License override'lari:** `isLicensed()` (feature set), 12 `is*Enabled()` + 3 quota metodu

---

## Dosya Yapisi

```
packages/U_CustomizeModule/
├── YAPILANLAR.md
├── ldap/                      <- Cleanroom LDAP (5 dosya)
│   ├── ldap.module.ts
│   ├── ldap.service.ts
│   ├── ldap.controller.ts
│   ├── auth-method-utils.ts
│   ├── constants.ts
│   └── types.ts
├── provisioning/              <- Cleanroom Provisioning + Override merkezi (5 dosya)
│   ├── provisioning.module.ts
│   ├── provisioning.service.ts
│   ├── provisioning.controller.ts
│   ├── role-mapping-rule.service.ts
│   └── role-mapping-rule.controller.ts
├── environments/              <- Cleanroom Variables (3 dosya)
│   ├── variables.controller.ts
│   ├── variables.service.ts
│   └── project-access.ts
├── source-control/            <- Cleanroom Source Control (5 dosya)
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
└── frontend-overrides/
    └── frontend.service.ts
```
