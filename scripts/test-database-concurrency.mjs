import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const databaseUrl = process.env.PLUTO_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const target = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    || target.search || target.hash) {
    throw new Error('Concurrency fixtures require an isolated loopback database');
}
function sql(query, applicationName = 'pluto-regression') {
    return new Promise((resolve, reject) => {
        const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], {
            env: { ...process.env, PGDATABASE: databaseUrl, PGAPPNAME: applicationName, PGCONNECT_TIMEOUT: '5' },
            timeout: 30_000,
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.resume();
        child.on('error', reject);
        child.on('exit', code => resolve({ code, output: output.trim() }));
    });
}
const userId = randomUUID(), threadId = randomUUID(), anchorId = randomUUID();
const identity = `select set_config('request.jwt.claim.sub','${userId}',false);`;
async function race(firstQuery, secondQuery) {
    const first = sql(`begin; set local statement_timeout='10s';
        select id from public.threads where id='${threadId}' for update;
        select pg_sleep(2); ${identity} ${firstQuery} commit;`, 'pluto-race-first');
    let locked = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        const observed = await sql("select exists(select 1 from pg_stat_activity where application_name='pluto-race-first' and wait_event='PgSleep');");
        if (observed.code === 0 && observed.output === 't') { locked = true; break; }
        await delay(30);
    }
    assert.ok(locked, 'First transaction must hold the conversation lock before the second starts');
    const second = sql(`set statement_timeout='10s'; ${identity} ${secondQuery}`, 'pluto-race-second');
    return Promise.all([first, second]);
}
try {
    const setup = await sql(`
        insert into auth.users(id,aud,role,email) values('${userId}','authenticated','authenticated','race-${userId}@example.test');
        insert into public.threads(id,user_id,title,model) values('${threadId}','${userId}','Concurrency fixture','test-model');
        insert into public.messages(id,thread_id,user_id,role,content) values('${anchorId}','${threadId}','${userId}','user','Original');
    `);
    assert.equal(setup.code, 0, 'Could not create isolated concurrency fixtures');
    const edit = (id, content) => `select * from public.edit_user_message('${threadId}','${id}','${content}','test-model','[]'::jsonb);`;
    const outcomes = await race(edit(anchorId, 'First replacement'), edit(anchorId, 'Second replacement'));
    assert.equal(outcomes[0].code, 0, 'First edit failed');
    assert.notEqual(outcomes[1].code, 0, 'A competing edit of the deleted anchor must fail');
    const remaining = await sql(`select count(*), min(content) from public.messages where thread_id='${threadId}' and deleted_at is null;`);
    assert.equal(remaining.code, 0);
    assert.equal(remaining.output, '1|First replacement', 'Competing edits left inconsistent active history');
    console.log('Database concurrency: competing edits serialize and reject a stale anchor.');

    const active = await sql(`select id from public.messages where thread_id='${threadId}' and deleted_at is null;`);
    assert.equal(active.code, 0);
    const activeId = active.output;
    assert.match(activeId, /^[\da-f-]{36}$/);
    const jobId = randomUUID();
    const claimed = await sql(`${identity}
        insert into public.generation_jobs(id,thread_id,user_message_id,user_id,model_id,status)
        values('${jobId}','${threadId}','${activeId}','${userId}','test-model','pending');
        select claim.claim_token from public.claim_pending_generation_job('${threadId}','${activeId}',30) claim;`);
    assert.equal(claimed.code, 0);
    const token = claimed.output.split('\n').at(-1);
    assert.match(token, /^[\da-f-]{36}$/);
    const persistence = await race(edit(activeId, 'Edited during generation'),
        `select public.persist_generation_response('${jobId}','${token}','test-model','Stale reply','',null);`);
    assert.equal(persistence[0].code, 0, 'Edit deadlocked against response persistence');
    assert.notEqual(persistence[1].code, 0, 'Deleted prompt accepted a competing response');
    const replies = await sql(`select count(*) from public.messages where thread_id='${threadId}' and role='assistant' and deleted_at is null;`);
    assert.equal(replies.output, '0', 'Stale response was persisted after the edit');
    console.log('Database concurrency: edit and response persistence use consistent lock ordering.');

    const nextAnchor = await sql(`select id from public.messages where thread_id='${threadId}' and deleted_at is null;`);
    assert.equal(nextAnchor.code, 0);
    assert.match(nextAnchor.output, /^[\da-f-]{36}$/);
    const branching = await race(
        `select (public.branch_thread('${threadId}','${nextAnchor.output}')).id;`,
        `select public.soft_delete_messages(array['${nextAnchor.output}'::uuid],'manual',null);`);
    assert.equal(branching[0].code, 0, 'Branching deadlocked against message deletion');
    assert.equal(branching[1].code, 0, 'Message deletion deadlocked against branching');
    const branchId = branching[0].output.split('\n').at(-1);
    assert.match(branchId, /^[\da-f-]{36}$/);
    const copied = await sql(`select count(*),min(content) from public.messages where thread_id='${branchId}' and deleted_at is null;`);
    assert.equal(copied.output, '1|Edited during generation', 'Branch did not preserve the prefix before concurrent deletion');
    console.log('Database concurrency: branching and message deletion serialize without partial copies.');
} finally {
    const cleanup = await sql(`delete from public.threads where user_id='${userId}'; delete from auth.users where id='${userId}';`);
    assert.equal(cleanup.code, 0, 'Could not remove concurrency fixtures');
}
