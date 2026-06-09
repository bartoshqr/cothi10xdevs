to phase 4, adjust implementation and plan:

1. to debate, we need to add BLOCK option to store.ts; to disable changes.
1.1. Disable any changes for challenger NOW (even if accepted, in the future they will not be able to change Advocate nodes and edges; we need to store the author in node and edges data somehow, but this will go to s03)
1.2. Disable any changes to the advocate after sending an invitation and acceptation

2. After sending intitation, change info not Invite sent — awaiting response; but Invite sent to {challenger.username} for {n} rounds — awaiting response;
I also want to have an option to revoke my invitation (if it is still pending)

3. rename this id to debate_id: const { id } = Astro.params; in [id].astro

4.     if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchUsers(query);
    }, 250);

    So we fetch users every 250 mseconds even without typing anything? it's not a good idea if so 


5. What if a challenger accepts and an advocate won't refresh the page.., he would still see awaiting response..



6. I got errors with Something went wrong, because of the wrong uuids in seed users, we need to adjust seed users uuid. look:
with: 
{"debateId":"d0283827-7b31-4d57-b820-05e414197707","challengerId":"00000000-0000-0000-0000-000000000002","roundCount":3}
I got:
{
    "error": {
        "errors": [],
        "properties": {
            "challengerId": {
                "errors": [
                    "Invalid UUID"
                ]
            }
        }
    }
}

7. I also want see always pointer when sth is clickable, button or link, no matter what, also remember about creating reusable components while coding


8. Also you created a debate without root claim somehow, I don't know how, and it should be fixed, this possibility:
http://localhost:4321/debates/aaaaaaaa-0000-0000-0000-000000000001

9. prepare better seed.sql with ALL proper uuids to anything, and with 10 users already, and let's do supabase db reset