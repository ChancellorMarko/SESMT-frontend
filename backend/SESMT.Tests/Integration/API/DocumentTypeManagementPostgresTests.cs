using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SESMT.Domain.Modules.IdentityAccess.Entities;
using SESMT.Domain.Modules.Workforce.Entities;

namespace SESMT.Tests.Integration.API;

[Collection(PostgresCollection.Name)]
public sealed class DocumentTypeManagementPostgresTests(PostgresDatabaseFixture database)
{
    private async Task<HttpClient> Admin(PostgresApiFactory factory){var client=factory.CreateClient();await using var db=database.CreateContext();client.DefaultRequestHeaders.Add("X-Test-Actor",(await db.Users.SingleAsync(u=>u.Email.Value=="seed-admin@example.invalid")).Id.ToString());return client;}
    private static object Body(string? code=null)=>new{code=code??"TYPE-"+Guid.NewGuid().ToString("N"),name="Instrução operacional",description=(string?)null,category="OPERACIONAL",secrecyLevel="RESTRITO",requiresSignature=true,requiresApproval=true,periodicityInDays=(int?)null,retentionPeriodInYears=(int?)null,metadataSchema="{}",schemaVersion=1};
    private static async Task<JsonElement> Json(HttpResponseMessage r,HttpStatusCode status=HttpStatusCode.OK){var text=await r.Content.ReadAsStringAsync();Assert.True(r.StatusCode==status,text);return JsonDocument.Parse(text).RootElement.Clone();}
    private static JsonObject Update(JsonElement item){var node=JsonNode.Parse(item.GetRawText())!.AsObject();node.Remove("id");node.Remove("code");node.Remove("active");node["name"]="Identificação corrigida";return node;}
    private static HttpRequestMessage Patch(Guid id,string version,object body){var m=new HttpRequestMessage(HttpMethod.Patch,$"/api/v1/document-types/{id}"){Content=JsonContent.Create(body)};m.Headers.TryAddWithoutValidation("If-Match",$"\"{version}\"");return m;}
    [PostgresFact]
    public async Task CreatesRenamesAndAuditsWithAStablePersistedVersion(){
        await using var factory=new PostgresApiFactory(database);using var client=await Admin(factory);
        using var create=await client.PostAsJsonAsync("/api/v1/document-types",Body());var item=await Json(create,HttpStatusCode.Created);var id=item.GetProperty("id").GetGuid();
        using var read=await client.GetAsync($"/api/v1/document-type-management/{id}");var initial=await Json(read);Assert.Equal(initial.GetProperty("version").GetString(),create.Headers.ETag!.Tag.Trim('"'));
        using var command=Patch(id,initial.GetProperty("version").GetString()!,Update(item));using var edit=await client.SendAsync(command);await Json(edit);
        using var after=await client.GetAsync($"/api/v1/document-type-management/{id}");var stored=await Json(after);Assert.NotEqual(initial.GetProperty("version").GetString(),stored.GetProperty("version").GetString());
        Assert.Equal("Identificação corrigida",stored.GetProperty("item").GetProperty("name").GetString());Assert.True(stored.GetProperty("item").GetProperty("requiresSignature").GetBoolean());
        using var history=await client.GetAsync($"/api/v1/document-type-management/{id}/history");var events=await Json(history);Assert.Equal(2,events.GetArrayLength());Assert.All(events.EnumerateArray(),e=>Assert.False(string.IsNullOrWhiteSpace(e.GetProperty("actorName").GetString())));
        await using var db=database.CreateContext();Assert.All(await db.AuditLogs.Where(a=>a.ResourceId==id&&a.ResourceType=="tipo_documental").ToArrayAsync(),a=>Assert.True(a.IsIntegrityValid()));
    }
    [PostgresFact]
    public async Task PolicyChangesAndStaleOrMissingVersionsNeverOverrideTheType(){
        await using var factory=new PostgresApiFactory(database);using var client=await Admin(factory);using var create=await client.PostAsJsonAsync("/api/v1/document-types",Body());var item=await Json(create,HttpStatusCode.Created);var id=item.GetProperty("id").GetGuid();
        using var read=await client.GetAsync($"/api/v1/document-type-management/{id}");var state=await Json(read);var version=state.GetProperty("version").GetString()!;
        using var missing=await client.PatchAsJsonAsync($"/api/v1/document-types/{id}",Update(item));Assert.Equal((HttpStatusCode)428,missing.StatusCode);
        foreach(var key in new[]{"requiresSignature","requiresApproval","secrecyLevel","category","periodicityInDays","retentionPeriodInYears","metadataSchema","schemaVersion"}){
            var update=Update(item);update[key]=key switch{"requiresSignature" or "requiresApproval"=>JsonValue.Create(false),"secrecyLevel"=>JsonValue.Create("INTERNO"),"category"=>JsonValue.Create("OUTRA"),"metadataSchema"=>JsonValue.Create("{\"novo\":true}"),_=>JsonValue.Create(2)};
            using var command=Patch(id,version,update);using var result=await client.SendAsync(command);Assert.Equal(HttpStatusCode.Conflict,result.StatusCode);
        }
        using(var command=Patch(id,version,Update(item)))using(var valid=await client.SendAsync(command)){await Json(valid);}
        using var staleCommand=Patch(id,version,Update(item));using var stale=await client.SendAsync(staleCommand);Assert.Equal(HttpStatusCode.Conflict,stale.StatusCode);
    }
    [PostgresFact]
    public async Task ScopedAdministratorAndWorkerCannotWriteTheSharedCatalog(){
        await using var factory=new PostgresApiFactory(database);using var admin=await Admin(factory);using var create=await admin.PostAsJsonAsync("/api/v1/document-types",Body());var item=await Json(create,HttpStatusCode.Created);var id=item.GetProperty("id").GetGuid();
        await using var db=database.CreateContext();
        foreach(var code in new[]{"ADMIN","GESTOR","TECNICO","TRABALHADOR"}){
            var key=Guid.NewGuid().ToString("N");var user=new User("Consulta de catálogo",key+"@example.invalid","fixture-only");var role=await db.Roles.SingleAsync(r=>r.Code==code);var scope=new UserScope(user.Id,"EMPRESA");scope.Update(user.Id,"EMPRESA",database.CompanyA);db.AddRange(user,scope,new UserRole(user.Id,role.Id,database.CompanyA));
            if(code=="TRABALHADOR")db.Add(new Worker(database.CompanyA,key[..24],[1,2,3],key+key,"Pessoa do catálogo",new(1990,1,1),new(2020,1,1),null,null,database.UnitA,null,user.Id));
            await db.SaveChangesAsync();
            using var client=factory.CreateClient();client.DefaultRequestHeaders.Add("X-Test-Actor",user.Id.ToString());
            using var readContext=await client.GetAsync("/api/v1/document-type-management/context");Assert.False((await Json(readContext)).GetProperty("canManage").GetBoolean());
            using var post=await client.PostAsJsonAsync("/api/v1/document-types",Body());Assert.Equal(HttpStatusCode.Forbidden,post.StatusCode);
            using var patch=await client.PatchAsJsonAsync($"/api/v1/document-types/{id}",Update(item));Assert.Equal(HttpStatusCode.Forbidden,patch.StatusCode);
            using var delete=await client.DeleteAsync($"/api/v1/document-types/{id}");Assert.Equal(HttpStatusCode.Forbidden,delete.StatusCode);
        }
    }
    [PostgresFact]
    public async Task RejectsInvalidConfigurationAndUnknownFieldsWithoutCreatingRows(){
        await using var factory=new PostgresApiFactory(database);using var client=await Admin(factory);var code="INVALID-"+Guid.NewGuid().ToString("N");
        foreach(var (key,value) in new (string,JsonNode?)[]{("periodicityInDays",JsonValue.Create(0)),("retentionPeriodInYears",JsonValue.Create(-1)),("metadataSchema",JsonValue.Create("[]")),("schemaVersion",JsonValue.Create(0)),("secrecyLevel",JsonValue.Create("PUBLICO")),("allowSelfApproval",JsonValue.Create(true))}){
            var body=JsonSerializer.SerializeToNode(Body(code))!.AsObject();body[key]=value;using var result=await client.PostAsJsonAsync("/api/v1/document-types",body);Assert.Equal(HttpStatusCode.BadRequest,result.StatusCode);
        }
        await using var db=database.CreateContext();Assert.False(await db.DocumentTypes.AnyAsync(t=>t.Code==code));
    }
    [PostgresFact]
    public async Task TwoRenamesWithTheSameVersionHaveExactlyOneWinner(){
        await using var factory=new PostgresApiFactory(database);using var client=await Admin(factory);using var create=await client.PostAsJsonAsync("/api/v1/document-types",Body());var item=await Json(create,HttpStatusCode.Created);var id=item.GetProperty("id").GetGuid();using var read=await client.GetAsync($"/api/v1/document-type-management/{id}");var version=(await Json(read)).GetProperty("version").GetString()!;
        using var one=Patch(id,version,Update(item));using var two=Patch(id,version,Update(item));var results=await Task.WhenAll(client.SendAsync(one),client.SendAsync(two));
        try{Assert.Single(results,r=>r.StatusCode==HttpStatusCode.OK);Assert.Single(results,r=>r.StatusCode==HttpStatusCode.Conflict);}finally{foreach(var r in results)r.Dispose();}
    }
    [PostgresFact]
    public async Task ListFiltersAndPaginationUseActualTypeCounts(){
        await using var factory=new PostgresApiFactory(database);using var client=await Admin(factory);var marker="PAG-"+Guid.NewGuid().ToString("N")[..10];
        for(var i=0;i<3;i++){using var r=await client.PostAsJsonAsync("/api/v1/document-types",Body(marker+i));await Json(r,HttpStatusCode.Created);}
        using var result=await client.GetAsync($"/api/v1/document-type-management?q={marker}&page=2&pageSize=2");var page=await Json(result);Assert.Equal(3,page.GetProperty("total").GetInt32());Assert.Equal(1,page.GetProperty("items").GetArrayLength());
    }
    [PostgresFact]
    public async Task UsedTypesCannotBeDeactivatedEvenWithAValidVersion(){
        await using var factory=new PostgresApiFactory(database);using var client=await Admin(factory);await using var db=database.CreateContext();var id=(await db.Documents.SingleAsync(d=>d.Id==database.DocumentA)).DocumentTypeId;
        using var read=await client.GetAsync($"/api/v1/document-type-management/{id}");var state=await Json(read);
        using var command=new HttpRequestMessage(HttpMethod.Delete,$"/api/v1/document-types/{id}");command.Headers.TryAddWithoutValidation("If-Match",$"\"{state.GetProperty("version").GetString()}\"");using var response=await client.SendAsync(command);Assert.Equal(HttpStatusCode.Conflict,response.StatusCode);
        Assert.True((await db.DocumentTypes.AsNoTracking().SingleAsync(t=>t.Id==id)).Active);
    }
}
