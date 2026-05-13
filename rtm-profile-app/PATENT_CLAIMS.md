# Provisional Patent Claim Language
## FOR ATTORNEY USE — Not yet filed
## Confidential — Do not publish or distribute

---

### Invention 1: Cohort Spectral Fingerprinting with MAD-based Outlier Rejection

**Title**: Method for Constructing a Perceptual Spectral Fingerprint of an Audio Engineer's
Mastering Style from a Corpus of Reference Masters

**Field of Invention**:
The present invention relates to audio signal processing and music production analytics,
specifically to computer-implemented methods for deriving a statistically robust spectral
identity fingerprint from a corpus of audio recordings attributable to a single audio engineer,
mastering facility, or production style cohort.

**Background**:
Prior systems for automated audio mastering (e.g., LANDR, US9654869; eMastered; iZotope
Ozone AI) derive target parameters from a single reference track or a fixed internal model.
No prior system constructs a per-engineer spectral fingerprint by aggregating measurements
across a user-supplied corpus, nor applies robust statistical outlier rejection to protect
the cohort aggregate from genre-mismatched or corrupted tracks. Existing spectral analysis
tools (e.g., Izotope Tonal Balance Control) compare a signal to a fixed genre target; they
do not build a personalised, multi-track cohort fingerprint with quantified spread and
outlier detection. Automated mastering references (Spotify Loudness Normalisation, AES
streaming targets) are loudness-only and do not capture per-band tonal shape as an engineer
identity attribute.

**Summary of Invention**:
The invention is a computer-implemented method that receives a corpus of audio files
associated with a single audio engineer (or style cohort), computes a power spectral density
estimate for each file using a flat-top windowed Welch periodogram, maps those estimates to
a fixed set of perceptually-spaced frequency bands, mean-centres each per-file band vector
to isolate tonal shape from absolute loudness, and aggregates across the corpus using the
median (not mean) to produce a robust cohort curve. The method additionally computes the
per-band median absolute deviation (MAD) of the cohort as a measure of stylistic consistency,
detects and flags per-track outliers whose per-band RMS deviation from the cohort median
exceeds a threshold, and derives a scalar cohort distinctiveness metric (ratio of mean MAD
to mean absolute curve amplitude) to quantify how singular the engineer's style is relative
to genre averages. The resulting fingerprint — a mean-centred spectral curve with associated
MAD spread and distinctiveness scalar — is stored as a versioned, cryptographically-verified
JSON document (see Invention 2).

**Claims** (draft — attorney will refine):

1. A computer-implemented method for constructing an audio engineer style fingerprint
   comprising:
   - receiving, by a processor, a corpus of two or more audio files attributable to a single
     audio engineer or mastering facility;
   - computing, for each audio file in the corpus, a power spectral density estimate using a
     flat-top windowed Welch periodogram;
   - mapping each power spectral density estimate to a plurality of perceptually-spaced
     frequency bands to produce a per-file band-energy vector;
   - mean-centering each per-file band-energy vector to remove absolute loudness contribution
     and isolate tonal shape;
   - computing a per-band median across all per-file band-energy vectors in the corpus to
     produce a cohort spectral curve;
   - computing a per-band median absolute deviation (MAD) across all per-file band-energy
     vectors to produce a cohort spread vector; and
   - storing the cohort spectral curve and cohort spread vector as a spectral fingerprint
     associated with the audio engineer.

2. The method of claim 1, further comprising:
   - for each audio file, computing a per-band RMS deviation between the per-file band-energy
     vector and the cohort spectral curve;
   - comparing the per-band RMS deviation to a threshold; and
   - flagging the audio file as a cohort outlier when the per-band RMS deviation exceeds the
     threshold, thereby excluding the outlier's contribution from the cohort spectral curve.

3. The method of claim 2, wherein the threshold for outlier detection is approximately 6 dB
   RMS deviation averaged across finite-valued frequency bands.

4. The method of claim 1, further comprising:
   - computing a cohort distinctiveness scalar as a ratio of mean per-band MAD to mean
     absolute per-band curve amplitude across the cohort spectral curve; and
   - storing the cohort distinctiveness scalar as a quality indicator of the spectral
     fingerprint.

5. The method of claim 1, wherein the plurality of perceptually-spaced frequency bands
   comprises 31 bands distributed according to a logarithmic frequency scale spanning
   20 Hz to the Nyquist frequency of the audio corpus.

6. The method of claim 1, wherein computing the power spectral density estimate further
   comprises:
   - down-mixing each audio file to a mono signal prior to spectral analysis; and
   - resampling the mono signal to a uniform sample rate prior to spectral analysis, such
     that audio files with differing original sample rates contribute comparably to the
     cohort aggregate.

7. The method of claim 1, wherein bands whose corresponding frequency exceeds the Nyquist
   frequency of a given audio file are assigned a not-a-number (NaN) value, and the per-band
   median computation uses a NaN-aware median function such that audio files with lower
   sample rates do not bias the cohort curve in high-frequency bands.

8. The method of claim 1, further comprising:
   - computing a per-file integrated loudness measurement in LUFS per ITU-R BS.1770;
   - aggregating the per-file LUFS measurements across the corpus to produce a cohort loudness
     profile comprising a median LUFS value and a loudness range spread; and
   - storing the cohort loudness profile alongside the cohort spectral curve as part of the
     spectral fingerprint.

9. The method of claim 1, further comprising:
   - separating each audio file into a plurality of source stems comprising at least vocals,
     drums, bass, and other using a deep neural network source-separation model;
   - computing a per-stem band-energy vector for each stem of each audio file;
   - aggregating per-stem band-energy vectors across the corpus to produce a per-stem cohort
     spectral sub-profile; and
   - storing the per-stem cohort spectral sub-profiles as a deep-scan extension of the
     spectral fingerprint.

10. The method of claim 9, wherein the cohort distinctiveness of per-stem spectral
    sub-profiles is further used to compute a masking index between a vocals stem and an
    other-instruments stem, the masking index being derived from the per-band cross-
    correlation of the respective per-stem spectral curves across the corpus.

11. A system for constructing an audio engineer style fingerprint comprising:
    - one or more processors; and
    - a non-transitory computer-readable medium storing instructions that, when executed by
      the one or more processors, perform the method of any of claims 1 through 10.

12. A non-transitory computer-readable medium storing an audio engineer style fingerprint
    data structure produced by the method of claim 1, the data structure comprising:
    - a cohort spectral curve represented as an ordered array of floating-point values
      indexed by frequency band;
    - a cohort spread vector represented as an ordered array of median absolute deviation
      values indexed by frequency band;
    - a cohort distinctiveness scalar;
    - a sample count indicating the number of audio files contributing to the fingerprint;
      and
    - an integrity verification value computed over the data structure contents.

---

**Prior Art to Disclose**:
- US9654869B2 (LANDR Audio Inc., "Automatic mastering of audio content using neural network
  trained on human-mastered audio") — relevant because it uses a single reference or internal
  model; does not disclose multi-track cohort aggregation or MAD-based outlier rejection.
- US9304988B2 (LANDR Audio Inc., "System and method for automatic audio mastering") — relevant
  as prior automated mastering art; loudness-target only, no per-engineer tonal fingerprint.
- US20190371319A1 (iZotope, "Tonal balance control") — relevant because it compares a signal
  to a genre target curve; does not disclose corpus aggregation or per-engineer cohort
  construction.
- arXiv:2110.01320 (Steinmetz et al., "Automatic music mixing with deep learning and out-of-the-box
  audio effects") — relevant as learned audio style prior art; does not disclose per-engineer
  corpus fingerprinting.
- arXiv:2404.16969 (MuQ-MuLan) — relevant as audio embedding art; embeddings are not the
  same as the spectral-curve fingerprint of the present invention.
- Welch, P.D. (1967), "The use of fast Fourier transform for the estimation of power spectra"
  — foundational Welch periodogram method, well-known prior art; the novelty of the present
  invention is in the corpus aggregation pipeline built on top of it, not in the PSD
  estimation method itself.

**Why It's Novel**:
No prior art constructs a personalised, per-engineer spectral fingerprint by (1) aggregating
Welch PSD estimates across a multi-track corpus, (2) mean-centering to separate tonal shape
from loudness, (3) using the median (not mean) as the cohort aggregate to resist outlier
tracks, (4) computing per-band MAD as a first-class measure of cohort consistency, (5)
detecting and flagging per-track outliers by RMS deviation threshold, and (6) deriving a
scalar cohort distinctiveness metric. The combination of these six steps as a coherent pipeline
for engineer identity characterisation is novel. The per-stem deep-scan extension (claim 9)
applying the same pipeline to source-separated stem signals is additionally novel.

---
---

### Invention 2: Cryptographically-Signed Versioned Audio Engineer Profile as Identity Asset

**Title**: System and Method for Creating, Verifying, and Distributing a Cryptographically
Authenticated Audio Engineer Identity Profile

**Field of Invention**:
The present invention relates to digital content authentication and professional identity
management in the field of audio production, specifically to a versioned, self-contained,
cryptographically-verified data format that encodes an audio engineer's mastering style as
a machine-readable identity asset suitable for distribution, licensing, and automated
comparison.

**Background**:
Audio engineers currently have no machine-readable identity format. Professional credits
are recorded in text databases (AllMusic, Discogs, ISNI) but carry no technical content.
Mastering house specifications (e.g., "House Curve" documentation) are distributed as
proprietary non-interoperable formats or informal PDF documents with no integrity verification.
No prior system ties a statistically-derived spectral fingerprint to a human identity in a
tamper-evident, versioned, and portable data structure. Cryptographic signing of audio
metadata has been applied to NFT audio ownership (e.g., EIP-721) but not to engineer style
fingerprints as licensable professional identity assets. Existing DAW preset formats (VST3
preset, AU preset, FXP/FXB) are plugin-specific and do not generalise across tools.

**Summary of Invention**:
The invention is a data format and associated method for producing a self-contained, versioned,
and cryptographically-authenticated audio engineer identity profile. The profile encodes:
a cohort spectral fingerprint (as described in Invention 1), scalar loudness and dynamic range
statistics, an optional per-stem deep-scan extension, an optional target-plugin fingerprint for
plugin-version drift detection, version compatibility bounds expressed as semantic version
strings, and an HMAC-SHA256 integrity field computed over all other profile fields using a
key derived from the engineer's name and the schema version number. The resulting profile is
a self-verifying JSON document that can be distributed, compared, licensed, and version-checked
without requiring a central authority, private key infrastructure, or online verification
service. A consumer application can independently verify the profile's integrity and detect
tampering or manual editing by recomputing the HMAC and comparing to the stored value.

**Claims** (draft — attorney will refine):

1. A computer-implemented method for producing a cryptographically-authenticated audio
   engineer identity profile comprising:
   - computing a cohort spectral fingerprint for an audio engineer from a corpus of audio
     files attributable to the engineer;
   - assembling a profile data structure comprising the cohort spectral fingerprint, a schema
     version identifier, an engineer name field, and one or more aggregate acoustic measurements
     derived from the corpus;
   - serialising the profile data structure to a canonical byte representation excluding any
     pre-existing integrity field;
   - deriving a cryptographic key from at least the engineer name field and the schema version
     identifier;
   - computing an HMAC-SHA256 digest of the canonical byte representation using the derived
     cryptographic key; and
   - storing the HMAC-SHA256 digest within the profile data structure as an integrity field,
     thereby producing a self-verifying identity profile.

2. The method of claim 1, wherein serialising the profile data structure comprises:
   - sorting all key-value pairs of the profile data structure lexicographically by key prior
     to serialisation, ensuring canonical ordering independent of the order in which fields
     were added.

3. The method of claim 1, further comprising:
   - receiving a candidate profile data structure;
   - extracting the stored HMAC-SHA256 digest from the candidate profile;
   - recomputing the HMAC-SHA256 digest over the remaining fields of the candidate profile
     using the derived cryptographic key; and
   - determining that the candidate profile is authentic and unmodified when the recomputed
     digest matches the extracted digest.

4. The method of claim 1, wherein the profile data structure further comprises:
   - a minimum version compatibility bound expressed as a semantic version string; and
   - a maximum version compatibility bound expressed as a semantic version string;
   wherein a consumer application can determine whether the profile is compatible with a
   given version of the consumer application without requiring network access.

5. The method of claim 1, wherein the profile data structure further comprises a target-
   plugin fingerprint field comprising a hash of a target audio processing plugin's format
   identifier, plugin UID, plugin version, and parameter count; wherein a consumer application
   can detect version drift between the plugin version used when the profile was built and
   the currently-installed plugin version.

6. The method of claim 5, wherein the target-plugin fingerprint is a SHA-256 digest of a
   concatenation of the plugin format identifier, plugin UID, plugin version identifier, and
   parameter count, separated by a defined delimiter.

7. The method of claim 1, wherein the profile data structure is encoded as a JavaScript
   Object Notation (JSON) document, and the integrity field is stored as a hexadecimal
   string representation of the HMAC-SHA256 digest.

8. The method of claim 1, wherein the aggregate acoustic measurements comprise at least:
   - a median integrated loudness value in LUFS per ITU-R BS.1770;
   - a loudness range value per EBU R128;
   - a peak-to-loudness ratio value; and
   - a dynamic range spread value derived from per-file LUFS variance across the corpus.

9. The method of claim 1, further comprising:
   - computing a cohort distinctiveness scalar from the cohort spectral fingerprint; and
   - storing the cohort distinctiveness scalar in the profile data structure as a quality
     indicator of the identity profile, enabling consumers to assess whether the profile
     represents a statistically distinctive engineering style.

10. The method of claim 1, further comprising:
    - computing a per-band spread vector from the cohort spectral fingerprint representing
      the median absolute deviation of per-band energy across the corpus; and
    - storing the per-band spread vector in the profile data structure alongside the cohort
      spectral curve, enabling consumers to compute confidence-weighted similarity scores
      that weight frequency bands by the inverse of their cohort spread.

11. A system for verifying the authenticity of an audio engineer identity profile comprising:
    - one or more processors; and
    - a non-transitory computer-readable medium storing instructions that, when executed,
      perform the method of any of claims 3 through 10.

12. A non-transitory computer-readable medium storing a cryptographically-authenticated audio
    engineer identity profile data structure comprising:
    - a schema version identifier;
    - an engineer name or identifier;
    - a cohort spectral curve as an ordered array of floating-point values;
    - a cohort spread vector as an ordered array of median absolute deviation values;
    - one or more scalar acoustic statistics derived from a corpus of audio files;
    - a sample count indicating the size of the corpus; and
    - an HMAC-SHA256 integrity field computed over all other fields in canonical serialised
      form, using a key derived from the engineer name and schema version identifier.

13. A computer-implemented method for comparing a mix under evaluation to an audio engineer
    identity profile comprising:
    - receiving a mix audio file and an audio engineer identity profile produced by the method
      of claim 1;
    - verifying the integrity of the audio engineer identity profile by recomputing the HMAC-
      SHA256 digest and comparing to the stored integrity field;
    - rejecting the comparison if the integrity check fails;
    - computing a spectral band-energy vector for the mix audio file using the same power
      spectral density method and frequency band mapping used to construct the profile's cohort
      spectral curve;
    - computing a per-band similarity score between the mix spectral vector and the profile
      cohort spectral curve; and
    - weighting each per-band similarity score by the inverse of the corresponding profile
      spread vector value, such that frequency bands where the engineer's corpus is
      consistently stylised contribute more to the overall similarity score than bands where
      the corpus shows high spread.

---

**Prior Art to Disclose**:
- US9654869B2 (LANDR) — automated mastering prior art; no integrity signing, no engineer
  identity, no versioning.
- US9304988B2 (LANDR) — same family; same relevance.
- EIP-721 (Ethereum NFT standard) — cryptographic ownership of digital assets; applies to
  media ownership, not professional identity style fingerprints; no HMAC-based self-
  verification.
- ISNI (International Standard Name Identifier, ISO 27729) — human identity standard for
  creative professionals; no technical content, no acoustic measurements, no integrity
  verification.
- VST3 preset format (Steinberg) — plugin-specific parameter serialisation; no acoustic
  measurements, no integrity field, no cross-tool portability.
- arXiv:2110.01320 (Steinmetz et al.) — learning audio style; no per-engineer signed profile
  format.
- RFC 2104 (HMAC) — foundational HMAC construction; the novelty of the present invention
  is not in HMAC per se but in its application to derive integrity verification for an audio
  engineer identity data structure using an engineer-name-and-schema-version-derived key.

**Why It's Novel**:
No prior system defines a self-verifying, versioned, portable audio engineer identity profile
as a first-class data format. The specific combination of: (1) a cohort-derived spectral
fingerprint as the core identity content, (2) HMAC-SHA256 computed over canonically-sorted
fields using a key derived from human-readable identity metadata (name + schema version),
(3) version compatibility bounds enabling forward/backward compatibility without a registry,
(4) an optional target-plugin fingerprint for plugin-version drift detection, and (5) a
cohort spread vector enabling confidence-weighted similarity scoring — this combination as a
unified, self-contained, distribution-ready JSON document is novel. The integrity field
design (key derived from name + schema version, not from a secret key) is specifically
designed for a trust model where the profile is freely shareable and the integrity check
detects accidental corruption or casual tampering rather than adversarial forgery — this
is a distinct and appropriate trust model for the domain that has no prior art.

---

## Filing Notes for Attorney

**Priority**: File Invention 1 within 30 days. File Invention 2 in the same engagement
(within 60 days). Filing together saves attorney time on shared background sections.

**Inventor(s)**: Confirm with client — likely single inventor given solo-development context.

**Provisional filing jurisdiction**: USPTO (United States Patent and Trademark Office).
Provisional buys 12 months before utility application is required. Cost: ~$320 USPTO fee
(micro entity or small entity depending on assignee structure) plus attorney preparation.

**Disclosure bar**: Client must not publish source code, technical blog posts, or public
demos of the specific pipeline prior to provisional filing. The HMAC-signed JSON format
(Invention 2) is particularly at risk if profile files are shared publicly before filing,
as the format is directly observable from the output.

**Commercial context**: The inventions are implemented in RTMcompare, a macOS/Windows
audio production tool. The profile format is the on-disk representation produced by
`build_profile.py`. See implementation files:
- `python/build_profile.py` — full implementation of both inventions
- `python/uai_stems/__init__.py` — source-separation backend referenced in Claim 9
  of Invention 1

**Recommended claims strategy**: Claim 13 of Invention 2 (the weighted comparison method
using inverse MAD spread weighting) may be the most commercially valuable claim — it
describes a comparison algorithm that competitors would need to license to implement
"RTMcompare-compatible" profiles. Ensure this claim survives prosecution.
