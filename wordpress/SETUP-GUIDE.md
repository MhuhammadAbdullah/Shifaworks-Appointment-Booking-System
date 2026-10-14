# WordPress se Booking System ka Connection: Complete Setup Guide

Yeh guide step by step batati hai ke kis cheez ko kahan set karna hai, taake har therapist ke WordPress profile page par
uska live availability calendar aaye. Pehle **staging** (test site) par karein, phir production par.

> Abhi tak yeh sab staging par test nahi hua. Production par tab jayein jab Part 9 ka checklist staging par poora ho jaye.

---

## Part 0: Poora nizam ek nazar mein

```
Therapist dashboard (booking site)  ->  Database  <-  Booking API  <-  WordPress page ka calendar (browser se)
   availability yahan badalti hai       ek hi jagah        public, sirf parhne wali endpoints

Calendar mein time chunne par visitor booking site ke form par jata hai:
   https://<booking-site>/<service>?provider=<address>&package=<id>&start=<time>
```

- Availability sirf booking system mein hoti hai. WordPress mein kuch copy nahi hota.
- WordPress mein har page par sirf ek cheez save hoti hai: therapist ka **address (slug)**.
- Booked slot wapas offer nahi hota. Double booking database aur booking transaction rokte hain (pehle jaisa, badla nahi).

## Part 1: Pehle yeh cheezen tayyar rakhein

| Cheez | Staging ke liye | Production ke liye |
| --- | --- | --- |
| WordPress site + **Elementor Pro** | alag test site | aapki asli site |
| Booking website (Next.js) | alag deployment | asli (`booking.shifaworks.com`) |
| Booking API (Express) | alag deployment | asli (`api.shifaworks.com`) |
| Database | alag (test) database | asli database |

Zaroori: staging aur production ke database, API aur WordPress **kabhi mix na hon**. Staging ki website ka address
production ki settings mein na likhein, aur ulta bhi nahi.

Aap ke paas yeh files honi chahiye (is project ke folder mein):
- Plugin ZIP: `wordpress/dist/shifa-availability-1.0.0.zip`
- Is guide ke saath: `wordpress/README.md`, `wordpress/STAGING.md`

## Part 2: Naya code API aur website par lagana

Yeh code pehle commit/deploy hona chahiye (abhi kuch commit nahi hua; commit aur deploy aap ki ijazat se hoga).
Changes additive hain: ek naya parhne wala endpoint, provider cards mein `slug`, aur booking form mein optional URL parameters.
**Database migration nahi hai.**

Deploy ka order:
1. API (aur shared package)
2. API ki settings (Part 3) lagayein aur API restart karein
3. Booking website (Next.js)
4. WordPress plugin (Part 4 se)

## Part 3: API ki settings (environment variables)

API ke hosting panel (jaise Vercel project settings) mein yeh variables dekhein/lagayein.

### 3.1 Naya variable: `PUBLIC_CORS_ORIGINS`
- Yeh batata hai ke kaun si WordPress site ka browser availability parh sakta hai.
- Format: sirf website ka address, aakhir mein `/` nahi, koi path nahi, `*` nahi. Kai hon to comma se alag karein.
- **Staging:** `PUBLIC_CORS_ORIGINS=https://staging.aapki-site.com` (sirf staging site).
- **Production:** `PUBLIC_CORS_ORIGINS=https://shifaworks.com,https://www.shifaworks.com`
- Production mein sirf `https://` chalta hai, warna API start hi nahi hoti.
- Khali chhodne par yeh feature band hota hai (calendar browser mein nahi chalega, sirf button dikhega).
- Yeh purane `CORS_ORIGINS` se alag hai. Us mein WordPress ka address **mat** daalein. `CORS_ORIGINS` mein sirf booking website ka address rehta hai.

### 3.2 Pehle se maujood variables jo theek hone chahiye
| Variable | Kya hona chahiye |
| --- | --- |
| `CORS_ORIGINS` | sirf booking website ka address (`https://booking.shifaworks.com`) |
| `APP_URL` | booking website ka address |
| `API_URL` | API ka apna address |
| `DEFAULT_ORGANIZATION_SLUG` | aap ki organization ka slug (public form isi se chalta hai) |
| `DATABASE_URL`, `DIRECT_URL` | us environment ke database ke |
| `EMAIL_PROVIDER` | staging par `console` ya `disabled`, taake test bookings par email na jaye |

### 3.3 `TRUST_PROXY_HOPS` (zaroor check karein)
- Yeh batata hai ke API ke samne kitne proxy hain, taake rate limit har visitor ke asli IP par lage.
- Default `0` hai. Proxy ke peeche `0` rakhne se **sab visitors ek hi IP maane jate hain** aur ek hi limit (300 requests/minute) share karte hain.
- Agar API Vercel par hai to aam taur par `1` hota hai. Yeh sirf andaza hai, confirm nahi.
- Staging par aise check karein: `RATE_LIMIT_MAX=5` kar dein, ek device se 6 baar
  `https://<staging-api>/api/v1/public/team/x` kholein, phir mobile data se ek baar kholein. Doosre network ko 429 nahi aana chahiye.
  Agar 429 aaye to value kam hai. Check ke baad `RATE_LIMIT_MAX` wapas purani kar dein.
- Production ki value tab badlein jab staging par yeh check ho jaye.

## Part 4: Booking website ki settings

Website (Next.js) ke variables, jo pehle se hone chahiye:
| Variable | Misaal |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://api.shifaworks.com` (staging par staging API) |
| `NEXT_PUBLIC_DEFAULT_TIMEZONE` | `Asia/Karachi` |
| `NEXT_PUBLIC_WEBSITE_URL` | `https://shifaworks.com` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | pehle jaise |

Nayi cheez ke liye koi naya variable nahi chahiye. Code badalne ke baad website ko dobara build/deploy karna hoga.

## Part 5: Booking dashboard mein therapist tayyar karna

Har therapist ke liye (Admin > Providers > therapist ko kholein):

1. **Profile**: naam, designation, gender settings (`acceptsMale` / `acceptsFemale`), **Active** hona zaroori hai.
2. **Services** card: kam az kam ek service assign karein (jaise Hijama Therapy). Service khuli (open) honi chahiye.
3. **Packages**: us service ka kam az kam ek **active package** hona chahiye (Admin > Services). Bina package ke calendar nahi aata.
4. **Availability tab**: weekly hours daalein. Chhutti, leave ya blocked time yahin lagti hai. Minimum notice aur kitne din aage tak booking ho sakti hai, yeh service ki settings se aata hai.
5. **Website calendar** card (Profile tab ke sabse upar):
   - **Provider address** dekhein aur **Copy** dabayein. Yeh WordPress mein paste hoga.
   - "Ready for the website?" ke teen nishan check karein.
   - "Test and troubleshooting links" mein booking form ka link aur wo data ka link khol kar test kar sakte hain.
6. Yeh address dashboard se badla nahi ja sakta. Isliye ek baar WordPress se jud jaye to link nahi tootta.

## Part 6: WordPress par plugin install karna

1. WordPress admin mein jayein: **Plugins > Add New > Upload Plugin**.
2. `shifa-availability-1.0.0.zip` chunein, **Install Now**, phir **Activate**.
3. Koi error ya warning nahi aani chahiye. Aaye to likh kar bhej dein.
4. Left menu mein **Settings > ShifaWorks Availability** kholein aur bharein:

| Field | Staging | Production |
| --- | --- | --- |
| Show the availability calendar | tick | tick |
| Booking API address | `https://<staging-api>/api/v1` | `https://api.shifaworks.com/api/v1` |
| Booking website | `https://<staging-booking-site>` | `https://booking.shifaworks.com` |
| Fallback button link | booking site ka address | `https://booking.shifaworks.com` |
| Fallback button text | `Book Appointment` | `Book Appointment` |

   - API address ke aakhir mein `/api/v1` zaroor ho, `/` nahi.
   - `http://` sirf local test (localhost) ke liye chalta hai. Asli site par `https://`.
5. **Save Changes** dabayein.

**Behtar tareeqa (galti se bachne ke liye):** `wp-config.php` mein yeh lines daalein, tab settings page par likhi values ki jagah yeh chalti hain:
```php
define( 'SHIFA_AV_API_BASE',     'https://api.shifaworks.com/api/v1' );
define( 'SHIFA_AV_BOOKING_BASE', 'https://booking.shifaworks.com' );
define( 'SHIFA_AV_FALLBACK_URL', 'https://booking.shifaworks.com' );
```
Staging site ki `wp-config.php` mein staging ke addresses likhein, taake wo galti se production se na jud jaye.

## Part 7: Elementor mein ek shared template banana

Yeh sirf **ek baar** karna hai. Sab team members isi template ko istemal karte hain.

1. WordPress admin: **Templates > Theme Builder > Single Page > Add New**.
2. Team member page ka design ek baar banayein (photo, naam, bio waghera).
3. Jahan calendar dikhana hai wahan Elementor ka **Shortcode** widget daalein aur likhein:
   ```
   [shifa_availability]
   ```
   Is mein kuch aur nahi likhna. Plugin har page se uska address khud uthata hai.
4. **Publish** dabayein. **Display Conditions** mein:
   - **Tareeqa A (recommended):** team members ke pages ko "Our Team" page ka **child page** banayein.
     Condition: Include > Pages > **Direct Child Of** > Our Team. Naya member bhi child banate hi template pa leta hai.
   - **Tareeqa B:** Include > Pages > har member ka page ek ek karke. Naye member par yeh condition mein add karna parega.
   - **"Our Team" listing page par yeh template mat lagayein.** Us page ka koi address nahi hota, wahan sirf button dikhega.
   - Elementor ki condition ke naam version ke hisaab se thore alag ho sakte hain. Staging par check karein.

## Part 8: Har team member ko jodna (naye member par bhi yahi)

1. **Dashboard:** Part 5 poora karein aur **Provider address copy** karein.
2. **WordPress:** is member ka page banayein (ya purana kholein). Us par Part 7 wala template lagna chahiye
   (child page ho ya condition mein shamil ho).
3. Page ko **WordPress ke normal editor** mein kholein: Pages > All Pages mein us page par sirf **Edit** dabayein
   (**"Edit with Elementor" nahi**, Elementor editor mein yeh box nahi aata). Elementor mein khul jaye to menu (≡) se
   "Exit to Dashboard" / "Back to WordPress Editor" chunein. Phir **"Booking system provider"** box dhoondein.
   Na mile to block editor mein upar right (⋮) > Preferences > Panels mein isay tick karein, ya purane editor mein
   "Screen Options" mein tick karein. Pages ki list mein "Booking provider" naam ka column hona chahiye (plugin chalne ki nishani).
   Agar team members Pages nahi balki kisi custom post type mein hain, to box wahan nahi aata (plugin abhi sirf Pages ke liye hai).
4. Address wahan **paste** karein. Space, capital ya `_` ho to plugin khud saaf kar deta hai.
5. **Update/Publish** dabayein.
6. Box mein dekhein:
   - Hara **"Linked to <naam>"** = theek.
   - Laal **"No active provider has this address"** = address galat hai ya provider inactive hai. Dashboard se dobara copy karein.
   - Peela **"Could not check right now"** = API tak nahi pohancha. Part 6 ka API address aur Part 3.1 dekhein.
   - **"Also used by"** = kisi aur page par bhi yehi address hai. Ek member ka sirf ek page hona chahiye.
7. Page kholein (logout hoke ya private window mein). Calendar dikhna chahiye.

Plugin kuch nahi dikhata (sirf button) ho to Part 11 dekhein.

## Part 9: Test checklist (staging par; production se pehle)

Test ke liye staging database mein do test therapists banayein, jaise address `stg-test-one` aur `stg-test-two`, alag alag weekly hours ke saath.
Kam az kam ek therapist ke paas do packages (alag lambai) hon. Test ke baad dono ko delete kar dein, warna woh public form par bookable rehte hain.

**Calendar**
- [ ] Pehle therapist ke page par sirf uski dates/times; doosre par sirf uski.
- [ ] Service aur package chunne se pehle koi date nahi dikhti.
- [ ] Package badalne par times badalte hain.
- [ ] Month aage/peeche chalta hai.
- [ ] Mobile (360 px) aur desktop dono theek.

**Booking**
- [ ] Time par click -> booking form khulta hai aur service, package, date, time pehle se bhare milte hain.
- [ ] Gender chunne ke baad therapist khud select hota hai. Doosra gender chunne par "isn't available" ka paigham aata hai.
- [ ] Form poora bhar kar test booking ho jati hai.
- [ ] Booking ke baad wo time profile par dobara nahi dikhta (refresh par, ya lagbhag ek minute mein).
- [ ] **Double booking:** ek hi time do browsers mein chunein, dono submit karein. Ek kamyab ho, doosre ko saaf "no longer available" ka paigham mile.
- [ ] Dashboard mein availability badalne par profile par ek minute mein badal jati hai.
- [ ] Booking form seedha kholein (bina parameters ke): pehle jaisa chalta hai.

**Galat halat mein button dikhna chahiye (khali jagah nahi)**
- [ ] Galat address
- [ ] Address khali
- [ ] Provider inactive
- [ ] Provider ki koi service/package nahi
- [ ] API band ho (settings mein API address galat kar ke dekhein)
- [ ] Browser mein JavaScript band ho
- [ ] Visitor ko koi technical error nahi dikhta. Admin (login ke saath) ko wajah dikhti hai.

**Security**
- [ ] `https://<api>/api/v1/public/team/<address>` kholein: sirf naam, designation, photo, gender flags, timezone, services aur packages.
  Email, phone ya koi internal cheez nahi.
- [ ] Dashboard (login) pehle jaisa chalta hai.
- [ ] Kisi aur website se availability parhne ki koshish: block honi chahiye.
- [ ] WordPress se booking submit karne ki koshish browser block kare.

**WordPress**
- [ ] Plugin activate hota hai, koi PHP warning nahi.
- [ ] Ek hi template do alag therapist pages par alag calendar dikhata hai.
- [ ] Page-caching/minify plugin chalu hone par bhi calendar theek chalta hai.
- [ ] Settings mein calendar ka tick hataane par har jagah sirf button dikhta hai.

## Part 10: Production par lagana (staging ke baad, aap ki manzoori se)

1. API par `PUBLIC_CORS_ORIGINS=https://shifaworks.com,https://www.shifaworks.com`. Staging ka address kabhi nahi.
2. `TRUST_PROXY_HOPS` wohi value jo staging par sahi nikli.
3. API deploy aur restart.
4. Booking website deploy.
5. Production WordPress par plugin install karein (Part 6), settings mein production addresses.
6. Elementor template (Part 7) banayein ya staging se import karein.
7. Pehle ek therapist jodein (Part 8), dekh kar baqi jodein.

## Part 11: Masla ho to

| Alamat | Wajah | Hal |
| --- | --- | --- |
| Sirf "Book Appointment" button, calendar nahi | address khali/galat, provider inactive, service ya package nahi | Part 8 step 6 ka box dekhein; dashboard ka "Website calendar" card dekhein |
| Button hi dikhta hai, aur box hara hai | browser API tak nahi pohancha | `PUBLIC_CORS_ORIGINS` mein bilkul yehi site ka address (www ke saath ya bina) hai? Browser console mein CORS error? |
| Box peela "Could not check right now" | API address galat ya API band | Plugin settings ka API address (aakhir mein `/api/v1`), API chal rahi hai? |
| Calendar aaya lekin koi date nahi | weekly hours nahi, ya package/service band, ya "minimum notice" se sab nikal gaya | Availability tab, service ki settings |
| Booking form par therapist khud select nahi hua | gender chunna baqi hai, ya therapist us gender ko nahi leta | pehle gender chunein |
| Time chuna lekin form ne "no longer available" kaha | kisi ne usi dauran wo time book kar liya | doosra time chunein (yeh sahi behaviour hai) |
| Sab visitors ko achanak 429 / "Too many requests" | `TRUST_PROXY_HOPS` kam | Part 3.3 |
| Admin ko page par peela note dikhta hai | address ka masla (sirf admin ko dikhta hai) | note ke mutabiq theek karein |
| Therapist ka address toot gaya | database mein seedha badla gaya | dashboard ka naya address WordPress box mein paste karein |

## Part 12: Band karna ya wapas lena (rollback)

Booking system ke data ko in mein se kisi se nuksan nahi hota. Tezi ke hisaab se:
1. Plugin settings mein **"Show the availability calendar"** ka tick hata dein: har page par sirf button.
2. Plugin deactivate karein. Phir Elementor template se shortcode bhi hata dein (warna wo text ki shakl mein dikhega).
3. API par `PUBLIC_CORS_ORIGINS` khali karke redeploy: browser availability parh nahi sakega.
4. Zarurat ho to code changes revert karein. Database mein koi migration nahi thi, wahan kuch undo nahi karna.
5. Test therapists/bookings delete karein (staging).

## Part 13: Jo abhi test nahi hua (sach)

- Asli WordPress aur Elementor Pro par plugin (sirf nakli stand-ins aur Chrome mein JS test hua).
- PHP 7.4 (sirf PHP 8.1 par chala).
- Asli therapist ke saath poora browser end-to-end booking.
- `TRUST_PROXY_HOPS` ki production value.
- Elementor ki Display Condition ke asli naam aap ke version mein.

Ye sab Part 9 ke checklist se staging par pakke karein.
