# AnalogLens: الخطة النهائية (الأحد 01:00، فاضل حوالي 11 ساعة)

مفترض إن التسليم حوالي 12:30. لو الميعاد مختلف، حرّك كل الأوقات بنفس الفرق.

## 1. إحنا بنعمل إيه (جملة واحدة)

صفحة ويب بتاخد موقع على المريخ (Medusae Fossae) ومهمة (rover mobility أو wind erosion)، وبترتّب آلاف المربعات على الأرض (كل مربع 30 km) حسب تشابهها مع الموقع ده **في كل dimension لوحده**، ولكل مربع بتعرض fingerprint card: إيه اللي بيشبه، قد إيه، وفين التشابه بيقع.

**الـ pitch:** أي فريق يقدر يقولك مكان شكله زي المريخ. إحنا بنقولك المكان ده ينفع لأنهي اختبار، وفين هيضللك.

## 2. شكل الموقع: story فيها جزء interactive

**القرار: صفحة واحدة بتتقري من فوق لتحت (story)، وفي نصها explorer تفاعلي (خريطة + card).** لا app تفاعلي صِرف ولا story صِرفة.

| السبب | التفصيل |
| --- | --- |
| التسليم فيديو 30 ثانية + 7 slides | الحكام غالبًا هيتفرجوا ومش هيجربوا. الفيديو محتاج تسلسل، والـ story بتتسجل scroll واحد. |
| عندنا target واحد ومهمتين | App كله dropdowns فيها اختيار واحد هيبان فاضي. الـ story بتخلي القليل الحقيقي يبان مقصود. |
| التحدي طالب tool وكمان "educate the public" | الـ explorer هو الـ tool، والـ story هي التعليم. |
| الأمان | لو الـ explorer وقع، الصفحة لسه شغالة بصور ثابتة. |

### أقسام الصفحة بالترتيب

| # | القسم | المحتوى | مصدر البيانات |
| --- | --- | --- | --- |
| 1 | Hero | "An Egyptian helped choose where Apollo landed. We built the tool for the next landings." + سطر واحد بيشرح الـ tool | نص ثابت (قصة فاروق الباز، المصدر في الـ prep kit) |
| 2 | المشكلة | مفيش مكان على الأرض بيشبه المريخ في كل حاجة، والمشهورين مستهلكين. الأسئلة التلاتة: إيه اللي بيشبه؟ قد إيه؟ فين بيقع؟ | نص ثابت |
| 3 | الطريقة | 3 خطوات: نفس الـ grid للكوكبين (463 m) ← score لكل dimension لوحده ← fingerprint. صورة الـ target جنب مربع من الأرض | `data/img/target_medusae_fossae.png` + صورة أعلى مربع |
| 4 | **Explorer** | خريطة عليها أعلى 50 مربع ملونين بالـ score. Toggle للمهمة. الضغط على مربع يفتح الـ card | `rank/…json` و`cards/…json` |
| 5 | هل الطريقة شغالة؟ | المواقع المعروفة وترتيبها (Lut، Death Valley، Meteor Crater…)، ومقارنة descriptors و DINOv2 | `validation.json` |
| 6 | مصر | الخارجة، الجلف الكبير، بحر الرمال، الصحراء البيضاء: ترتيب كل واحد + الدليل المنشور + فين بيقع | cell الـ percentiles + `config/egypt_candidates.json` |
| 7 | الحدود | الـ scale (463 m بيشوف texture مش yardangs مفردة)، الجاذبية والغلاف الجوي والإشعاع، القمر ماتشغلش | نص + جدول الـ limits من الـ prep kit |
| 8 | البيانات والفريق | كل dataset بمصدره، لينك الـ repo، أسماء الفريق، إفصاح استخدام AI | README |

### الـ fingerprint card (كل الحقول موجودة في الـ JSON)

- `task_label` و`score`
- `bars[]`: لكل dimension شريط فيه `label` و`score` و`weight` و`status` (strong أو breaks) و`earth_value` قصاد `target_value`
- `images.earth` جنب `images.target` بنفس الـ scale
- `strong_for[]` بالأخضر
- `breaks[]`: اللي `kind: "data"` بالأحمر (خاص بالمربع)، واللي `kind: "fixed"` في صندوق ثابت (الجاذبية، الغلاف الجوي، الإشعاع، المية)
- `tests[]`: اختبارات ممكن تتعمل هناك
- `nearest_known`: لو `novel: true` اكتب "Candidate new analog"، غير كده "Near known analog: <name>"

### الربط التقني (من غير backend)

انسخ فولدر `out/` جوه الـ frontend باسم `data/` واقرا الملفات مباشرة. نفس الـ JSON بتاع الـ API contract بالظبط، فمفيش تغيير في الـ contract:

| Endpoint | ملف |
| --- | --- |
| `/targets` | `data/targets.json` |
| `/tasks` | `data/tasks.json` |
| `/rank?target=T&task=K` | `data/rank/T__K.json` |
| `/card/ID?target=T&task=K` | `data/cards/T__K__ID.json` |
| `/validation` | `data/validation.json` |
| `/img/X.png` | `data/img/X.png` |

- مسارات الصور جوه الـ cards بتبدأ بـ `/img/…`، فحطوا قبلها `data`.
- كل مربع على الخريطة = مربع 30 km حوالين `lat` و`lon`.
- النشر: GitHub Pages (لما الـ repo يبقى public) أو Vercel أو Netlify. لازم لينك public يشتغل في نافذة incognito.
- ابدأوا دلوقتي على `sample_out/` (نفس الشكل، بيانات synthetic)، وبدّلوه بـ `out` الحقيقي أول ما يوصل. **ممنوع أي رقم من `sample_out` يظهر في الفيديو أو الـ slides.**

## 3. البيانات: إيه الحقيقي وإيه لأ

| المهمة | الـ dimensions | الحالة |
| --- | --- | --- |
| Rover mobility | terrain shape، slope، roughness، relief، aridity | **كاملة** بالـ DEM + NDVI |
| Wind-erosion science | terrain shape، linearity، aridity، dust | كاملة لو الـ dust وصل، غير كده يتكتب "dust not scored" |
| Dust mitigation | محتاجة dust + thermal | **تتشال** من الـ config |

حاجات لازم تتقال بصراحة في الموقع والـ slides:
- الـ terrain bar عند 463 m بيقارن texture التضاريس على scale الـ 30 km، مش yardangs مفردة.
- الـ score هو similarity، مش احتمال.
- عدد المواقع المعروفة قليل، فبنعرض ترتيب كل موقع مع `n`، مش رقم AUC لوحده.
- أهداف القمر متعرّفة في الـ config وماتشغلتش.

## 4. الخطوات والجدول الزمني

| الوقت | CV/AI | ML/data | Full-stack ×2 | Product |
| --- | --- | --- | --- | --- |
| 01:00–01:45 | Cells 5b–8 (المنطقة الواسعة + المواقع المعروفة) بـ `--cards 50`. شيل `dust_mitigation` من `config/targets.json`. Zip ← **out v1** | NDVI: MOD13C2 ← GeoTIFF ← `sample_climate.py` | هيكل الصفحة (الـ 8 أقسام) على `sample_out` | Slides 1–3 + نص الـ hero والمشكلة |
| 01:45–02:30 | Cell لترتيب مواقع مصر. مراجعة أعلى 10 بالعين | Dust من Giovanni (اختياري) | الـ explorer: خريطة + card على out v1 | الصورتين التوضيحيتين (THEMIS + الخارجة) بمصادرهم |
| 02:30–03:00 | Run نهائي بالـ features و`--max-ndvi 0.3` ← **out v2** | README: جدول الـ datasets | تبديل لـ out v2 | — |
| **03:00** | **Freeze. مفيش data ولا features جديدة.** | | | |
| 03:00–07:00 | نوم | نوم | نوم | نوم |
| 07:00–09:30 | أرقام slide 5 وقسم 5 و6 و7 | مراجعة المصادر والـ citations | Polish + نشر | Slides 4–7 |
| **09:30** | **الموقع live بلينك public** | | | |
| 09:30–10:30 | مراجعة كل رقم قصاد `validation.json` | — | تسجيل الفيديو | مونتاج 30 ثانية + الـ slides النهائية |
| 10:30–11:30 | الـ repo يبقى public، اختبار كل اللينكات incognito، التسليم | | | نص صفحة المشروع |
| 11:30–12:30 | Buffer | | | |

### Cut lines (من غير نقاش)

- **الـ NDVI ماخلصش لحد 02:30:** نسلّم terrain-only، ونشيل شريط aridity، ونكتبها في قسم الحدود.
- **الـ explorer مش شغال لحد 09:00:** نستبدل الخريطة بصورة ثابتة و3 cards مكتوبة يدوي من الـ JSON.
- **الأرقام طلعت وحشة:** نعرضها زي ما هي ونشرح ليه. الحكام بيقيّموا الـ validity مش الكمال.

## 5. الفيديو (30 ثانية، تسجيل شاشة للموقع + voice-over)

| الثانية | الصورة | الكلام |
| --- | --- | --- |
| 0–5 | الـ hero | "An Egyptian geologist helped choose where Apollo landed. We built AnalogLens for the next landings." |
| 5–11 | اختيار الـ target والمهمة، الخريطة بتنوّر | "Pick a Mars site and a mission task. AnalogLens scores [N] Earth tiles using NASA data." |
| 11–20 | فتح أعلى card: الشرايط، الصورتين، الأحمر | "Every result gets a fingerprint: what matches, how well, and where it breaks." |
| 20–26 | قسم الـ validation | "Known analogs rank in the top [X] percent." |
| 26–30 | اللوجو + اللينك | "AnalogLens. Know what a place can teach you, and where it will mislead you." |

`[N]` من `manifest.json` و`[X]` من `validation.json`. لو مفيش رقم حقيقي يشرّف، الجملة تتبدل بـ "We tested it on known analogs and report where it fails."

## 6. الـ 7 slides

| # | العنوان | الرسالة | المحتوى |
| --- | --- | --- | --- |
| 1 | AnalogLens | الاسم، الفريق، اسم التحدي | لوجو + الأسماء |
| 2 | Problem | مفيش analog كامل، والمشهورين مستهلكين | الأسئلة التلاتة من نص التحدي |
| 3 | Idea | الـ fingerprint: score لكل dimension ولكل مهمة | screenshot لـ card حقيقي |
| 4 | How | بيانات NASA + grid واحد للكوكبين + vision model | MOLA، ETOPO، MODIS، (MERRA-2)، DINOv2، رسمة الـ pipeline |
| 5 | Proof | المواقع المعروفة طلعت فين + descriptors قصاد DINOv2 | جدول من `validation.json` مع `n` |
| 6 | Discovery | مصر + أعلى candidates جديدة + قصة الباز | الخريطة + card + الصورتين التوضيحيتين (مكتوب عليهم illustration) |
| 7 | Impact and limits | مين هيستخدمه، إيه اللي الأرض ماتقدرش تقلده، الـ scale، الخطوة الجاية | جدول الـ limits + zoom scale والقمر كـ next steps |

## 7. Checklist التسليم

- [ ] Repo public وفيه README بكل dataset ومصدره
- [ ] لينك الموقع شغال في incognito
- [ ] فيديو 30 ثانية بلينك public
- [ ] 7 slides بلينك public
- [ ] نص صفحة المشروع: summary، NASA data used، اللينكات
- [ ] إفصاح استخدام AI لو الفورم سأل
- [ ] `"synthetic": false` في كل ملف معروض، ومفيش رقم من `sample_out`
- [ ] `DECISIONS.md` محدّث
