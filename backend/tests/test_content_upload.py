import asyncio
import importlib
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.routers import _uploaded_source
from app.core import models
from app.core.repository import _draft_preview, _generate_draft_preview, _healed_draft_preview


def test_pdf_upload_uses_pdf_library_text(monkeypatch):
    source_text = (
        "Vectors describe magnitude and direction in a coordinate system. "
        "Learners compare components, add arrows tip to tail, scale values, "
        "and explain how the same idea appears in movement, forces, and data."
    )

    class FakePage:
        def extract_text(self):
            return source_text

    class FakeReader:
        def __init__(self, stream):
            self.pages = [FakePage()]

    monkeypatch.setitem(sys.modules, "pypdf", types.SimpleNamespace(PdfReader=FakeReader))

    result = _uploaded_source("vectors.pdf", b"%PDF-1.7 fake bytes")

    assert result["content_type"] == "pdf"
    assert result["text"] == source_text
    assert result["characters"] == len(source_text)


def test_pdf_upload_keeps_domain_text_with_few_common_words(monkeypatch):
    source_text = " ".join(
        [
            "Radiopharmaceutical scintigraphy tomography attenuation collimator reconstruction isotope detector acquisition",
            "dosimetry radiotracer myocardial perfusion hepatobiliary lymphoscintigraphy fluorodeoxyglucose segmentation",
            "phantom calibration necrosis uptake washout biodistribution radiochemistry quantification protocol",
        ]
        * 5
    )

    class FakePage:
        def extract_text(self):
            return source_text

    class FakeReader:
        def __init__(self, stream):
            self.pages = [FakePage()]

    monkeypatch.setitem(sys.modules, "pypdf", types.SimpleNamespace(PdfReader=FakeReader))

    result = _uploaded_source("nuclear-medicine.pdf", b"%PDF-1.7 fake bytes")

    assert result["text"] == source_text
    assert result.get("extraction_warning") is None


def test_scanned_pdf_upload_returns_review_scaffold_instead_of_error(monkeypatch):
    class FakePage:
        def extract_text(self):
            return ""

    class FakeReader:
        def __init__(self, stream):
            self.pages = [FakePage()]

    monkeypatch.setitem(sys.modules, "pypdf", types.SimpleNamespace(PdfReader=FakeReader))

    result = _uploaded_source("Ch-02 (checked).pdf", b"%PDF-1.7 scanned bytes")

    assert result["content_type"] == "pdf"
    assert "extraction_warning" in result
    assert "Ch 02 (checked)" in result["text"]
    assert result["characters"] >= 20


def test_unreadable_docx_upload_returns_review_scaffold_instead_of_error():
    result = _uploaded_source("Ch-02.docx", b"")

    assert result["content_type"] == "docx"
    assert "extraction_warning" in result
    assert "Ch 02" in result["text"]
    assert result["characters"] >= 20


def test_missing_upload_payload_gets_title_scaffold():
    from app.api.routers import _fallback_uploaded_source

    result = _fallback_uploaded_source("Medical imaging")

    assert result["content_type"] == "text"
    assert "Medical imaging" in result["text"]
    assert result["characters"] >= 20


def test_stale_blocked_pdf_draft_heals_from_readable_source():
    source_text = (
        "Foundation of Digital Medical Imaging Technologies explains how digital medical imaging supports modern health care. "
        "It describes non-invasive visualization of anatomical and physiological structures for diagnosis, treatment planning, "
        "and monitoring. The chapter covers image acquisition, processing, interpretation, clinical applications, and future trends."
    )
    old_blocked_preview = {
        "needs_readable_source": True,
        "summary": "The uploaded source could not be converted into readable teaching text.",
    }

    healed = _healed_draft_preview(
        "lesson",
        "ch2",
        {"filename": "Ch-02 (checked).pdf", "content_type": "pdf", "text": source_text},
        old_blocked_preview,
    )

    assert healed["title"] == "ch2"
    assert healed["estimated_duration"] > 0
    assert healed["sections"]
    assert "needs_readable_source" not in healed


def test_noisy_pdf_text_gets_review_lesson_instead_of_blocked_preview():
    preview = _draft_preview(
        models.ContentDraftRequest(
            leader_id="teacher",
            kind="lesson",
            title="ch2",
            source_material={"filename": "Ch-02 (checked).pdf", "content_type": "pdf", "text": "PDF-1.6 137 0 obj xref trailer startxref 0000000016"},
        )
    )

    assert preview["estimated_duration"] > 0
    assert preview["sections"]
    assert "needs_readable_source" not in preview


def test_pdf_article_text_builds_teaching_lesson_not_author_metadata():
    source_text = (
        "Foundation of Digital Medical Imaging Technologies Shivani Sharma1, Yukta Kakkar2, Prince Bhardwaj3 "
        "Department of Computer Science and Engineering, ABES Institute of Technology, Ghaziabad, India. "
        "Corresponding author: shivani@gmail.com. Digital medical imaging has developed as an indispensable modality "
        "in modern health care systems, allowing non-invasive visualization of internal anatomic structures. "
        "Image acquisition converts physical signals into digital image data that can be processed, stored, and interpreted. "
        "Common modalities include X-ray, computed tomography, magnetic resonance imaging, ultrasound, and nuclear medicine. "
        "Artificial intelligence supports segmentation, reconstruction, diagnosis assistance, and workflow optimization. "
        "Learners should compare clinical applications, limitations, safety concerns, and future trends in medical imaging."
    )

    preview = _draft_preview(
        models.ContentDraftRequest(
            leader_id="teacher",
            kind="lesson",
            title="medical imaging",
            source_material={"filename": "Ch-02.pdf", "content_type": "pdf", "text": source_text},
        )
    )

    assert preview["estimated_duration"] >= 20
    assert preview["sections"]
    assert "Corresponding author" not in preview["summary"]
    assert "This lesson explains" in preview["summary"]


def test_ieee_paper_builds_conceptual_lesson_instead_of_front_matter():
    source_text = """IEEE TRANSACTIONS ON NEURAL NETWORKS AND LEARNING SYSTEMS, VOL. X, AUGUST 202X
Learning to Predict Gradients for Semi-Supervised Continual Learning
Yan Luo, Yongkang Wong, Member, IEEE, Mohan Kankanhalli, Fellow, IEEE
Abstract—A key challenge for machine intelligence is to learn new visual concepts without forgetting previously acquired knowledge.
There is a gap between continual learning and human learning because existing methods assume known labels.
Continual learning models can suffer from catastrophic forgetting while learning new tasks.
Semi-supervised continual learning uses labeled and unlabeled data, and the unlabeled classes may be unknown.
The authors propose a gradient learner trained on labeled data to predict pseudo gradients for unlabeled data.
The method maps learned features to gradients and uses a fitness loss to train the gradient learner.
Predicted gradients allow unlabeled samples to update an existing gradient-based continual learning model without pseudo labels.
Experiments evaluate classification accuracy, backward transfer, and forward transfer across several benchmarks.
The reported results show improved average accuracy and backward transfer, indicating less catastrophic forgetting.
Using more unrelated unlabeled data does not always improve performance, so the sampling trade-off matters.
The code is available at https://github.com/luoyan407/grad_prediction.git."""

    preview = _draft_preview(models.ContentDraftRequest(
        leader_id="teacher",
        kind="lesson",
        title="gradpred tnnls",
        source_material={"filename": "gradpred_tnnls.pdf", "content_type": "pdf", "text": source_text},
    ))

    assert preview["title"] == "Learning to Predict Gradients for Semi-Supervised Continual Learning"
    assert len(preview["sections"]) >= 4
    assert preview["sections"][0]["title"] == "The problem and why it matters"
    rendered = " ".join([preview["summary"], *preview["learning_objectives"], *(section["title"] for section in preview["sections"])]).lower()
    assert "ieee transactions" not in rendered
    assert "the code is available" not in rendered
    assert "using evidence from the uploaded source" not in rendered
    assert "proposed approach" in rendered
    assert "evidence and main findings" in rendered
    assert "how the approach works" in rendered
    assert "limitations and practical meaning" in rendered

    healed = _healed_draft_preview("lesson", "gradpred tnnls", {
        "filename": "gradpred_tnnls.pdf",
        "content_type": "pdf",
        "text": source_text,
    }, {
        "title": "gradpred tnnls",
        "summary": "This draft turns the uploaded source into a teachable lesson on gradpred tnnls.",
        "learning_objectives": ["Explain ieee transactions using evidence from the uploaded source."],
        "sections": [{"title": "Ieee Transactions On Neural Networks And Learning"}],
    })
    assert healed["title"] == "Learning to Predict Gradients for Semi-Supervised Continual Learning"
    assert healed.get("healed_from_source") is True


def test_request_change_regenerates_preview_with_instruction():
    from app.core.repository import _regenerated_draft_preview

    preview = _regenerated_draft_preview(
        "teacher",
        "lesson",
        "vectors",
        {
            "filename": "vectors.docx",
            "content_type": "docx",
            "text": "Vectors have magnitude and direction. Vector addition combines components. Learners use vectors to model force, motion, displacement, and data relationships in coordinate systems.",
        },
        "Add a simpler worked example.",
    )

    assert preview["revised_from_request"] is True
    assert preview["update_request"] == "Add a simpler worked example."
    assert preview["sections"]


def test_assessment_uses_uploaded_source_concepts():
    source_text = (
        "Digital medical imaging supports non-invasive diagnosis and treatment planning. "
        "Image acquisition converts physical signals into digital image data for processing and interpretation. "
        "Common modalities include X-ray, computed tomography, magnetic resonance imaging, ultrasound, and nuclear medicine. "
        "Artificial intelligence supports segmentation, reconstruction, diagnostic assistance, and workflow optimization. "
        "Safety concerns include radiation exposure, image quality, patient preparation, and correct interpretation."
    )

    preview = _draft_preview(
        models.ContentDraftRequest(
            leader_id="teacher",
            kind="assessment",
            title="medical imaging",
            source_material={"filename": "Ch-02.docx", "content_type": "docx", "text": source_text},
        )
    )

    assert len(preview["questions"]) >= 5
    assert preview["estimated_duration"] >= 15
    question_text = " ".join(question["question"] for question in preview["questions"])
    assert "uploaded document" in question_text
    assert "match" not in question_text.lower()
    assert "file appears to be scanned" not in question_text.lower()
    assert any("Image Acquisition" in question["topic"] or "Digital Medical Imaging" in question["topic"] for question in preview["questions"])


def test_assessment_blocks_unreadable_scaffold_instead_of_fake_questions():
    preview = _draft_preview(
        models.ContentDraftRequest(
            leader_id="teacher",
            kind="assessment",
            title="Ch 02",
            source_material={
                "filename": "Ch-02.docx",
                "content_type": "docx",
                "text": "The file appears to be scanned, image based, or otherwise missing selectable text, so the server could not read the page text directly.",
                "extraction_warning": "This file did not expose selectable text to the server.",
            },
        )
    )

    assert preview["needs_readable_source"] is True
    assert preview["questions"] == []


def test_assessment_asks_direct_questions_for_policy_document():
    source_text = (
        "I will not delete any company data or format the laptop at the time. "
        "I will return company equipment and preserve required files. "
        "I will keep confidential information secure after handover. "
        "I will not share credentials or internal company documents. "
        "I will follow the exit process and cooperate with asset verification."
    )

    preview = _draft_preview(
        models.ContentDraftRequest(
            leader_id="teacher",
            kind="assessment",
            title="company data policy",
            source_material={"filename": "policy.docx", "content_type": "docx", "text": source_text},
        )
    )

    question_text = " ".join(question["question"] for question in preview["questions"])
    assert len(preview["questions"]) >= 5
    assert "best matches" not in question_text.lower()
    assert "which statement" not in question_text.lower()
    assert any("what commitment" in question["question"].lower() or "what action" in question["question"].lower() for question in preview["questions"])


def test_old_match_assessment_heals_from_source():
    healed = _healed_draft_preview(
        "assessment",
        "company data policy",
        {
            "filename": "policy.docx",
            "content_type": "docx",
            "text": "I will not delete any company data or format the laptop at the time. I will return company equipment and preserve required files. I will keep confidential information secure after handover. I will not share credentials or internal company documents. I will follow the exit process and cooperate with asset verification.",
        },
        {
            "questions": [
                {
                    "question": "Which statement best matches the uploaded source section 'I Will Not Delete Any Company Data'?",
                    "options": ["I will not delete any company data or format the laptop at the time.", "A related but unsupported claim"],
                }
            ],
            "estimated_duration": 10,
        },
    )

    question_text = " ".join(question["question"] for question in healed["questions"])
    assert len(healed["questions"]) >= 5
    assert "best matches" not in question_text.lower()


def test_module_leader_generation_uses_one_bounded_source_grounded_call(monkeypatch):
    calls = []

    async def review(title, kind, analysis, draft, source_material):
        calls.append("quality")
        assert "Vectors have magnitude and direction" in source_material["text"]
        return {
            **draft,
            "agent_workflow": ["Source-Grounded Generation Agent", "Quality Review Contract"],
            "quality_review": {"status": "passed"},
        }

    monkeypatch.setattr("app.core.repository.langgraph_nodes.quality_review_agent", review)
    result = asyncio.run(
        _generate_draft_preview(
            models.ContentDraftRequest(
                leader_id="teacher",
                kind="lesson",
                title="vectors",
                source_material={"text": "Vectors have magnitude and direction. Vector addition combines components. Learners resolve vectors along coordinate axes and use them to model force, displacement, motion, and data relationships in practical situations."},
            )
        )
    )

    assert calls == ["quality"]
    assert result["quality_review"]["status"] == "passed"
    assert result["source_analysis"]["learning_objectives"]


if __name__ == "__main__":
    class MonkeyPatch:
        def setitem(self, mapping, key, value):
            mapping[key] = value

        def setattr(self, target, value):
            parts = target.split(".")
            for index in range(len(parts) - 1, 0, -1):
                try:
                    owner = importlib.import_module(".".join(parts[:index]))
                    for part in parts[index:-1]:
                        owner = getattr(owner, part)
                    setattr(owner, parts[-1], value)
                    return
                except ModuleNotFoundError:
                    continue
            raise ImportError(target)

    test_pdf_upload_uses_pdf_library_text(MonkeyPatch())
    test_pdf_upload_keeps_domain_text_with_few_common_words(MonkeyPatch())
    test_scanned_pdf_upload_returns_review_scaffold_instead_of_error(MonkeyPatch())
    test_unreadable_docx_upload_returns_review_scaffold_instead_of_error()
    test_missing_upload_payload_gets_title_scaffold()
    test_stale_blocked_pdf_draft_heals_from_readable_source()
    test_noisy_pdf_text_gets_review_lesson_instead_of_blocked_preview()
    test_pdf_article_text_builds_teaching_lesson_not_author_metadata()
    test_ieee_paper_builds_conceptual_lesson_instead_of_front_matter()
    test_request_change_regenerates_preview_with_instruction()
    test_assessment_uses_uploaded_source_concepts()
    test_assessment_blocks_unreadable_scaffold_instead_of_fake_questions()
    test_assessment_asks_direct_questions_for_policy_document()
    test_old_match_assessment_heals_from_source()
    test_module_leader_generation_uses_one_bounded_source_grounded_call(MonkeyPatch())
