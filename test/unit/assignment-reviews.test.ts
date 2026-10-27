import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateReview } from "../../src/access/assignment-reviews";
describe("mandatory assistant star feedback validation", () => {
  it("accepts each integer score and trims comments", () => {
    for (let score=1; score<=5; score++) assert.deepEqual(validateReview({score, comment:"  Работа выполнена качественно.  "}),
      {score, comment:"Работа выполнена качественно."});
  });
  it("rejects missing, coerced, fractional and out-of-range scores", () => {
    for (const score of [undefined,null,true,"4",0,-1,6,2.5,NaN,Infinity])
      assert.throws(()=>validateReview({score, comment:"Комментарий достаточной длины."}), /звёзд/);
  });
  it("requires a comment using database-compatible Unicode length", () => {
    for (const comment of [undefined,null,4,""," ".repeat(30),"коротко","a".repeat(2001),"\0".repeat(20),"😀".repeat(5)])
      assert.throws(()=>validateReview({score:4,comment}), /комментарий/);
    assert.equal(validateReview({score:5,comment:"😀".repeat(10)}).comment.length,20);
  });
});
