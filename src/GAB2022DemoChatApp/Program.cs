using Azure.Identity;
using Microsoft.Azure.WebPubSub.AspNetCore;
using Microsoft.Azure.WebPubSub.Common;

var builder = WebApplication.CreateBuilder(args);

builder.Services
    .AddWebPubSub(options => 
    {
#if DEBUG
        var credential = new AzureCliCredential();
#else
        var credential = new DefaultAzureCredential();
#endif
        var endpoint = new Uri(builder.Configuration["Azure:WebPubSub:Endpoint"]);
        options.ServiceEndpoint = new ServiceEndpoint(endpoint, credential);
    })
    .AddWebPubSubServiceClient<SampleChatHub>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRouting();

app.UseEndpoints(endpoints =>
{    
    endpoints.MapGet("/api/negotiate", async (WebPubSubServiceClient<SampleChatHub> serviceClient, HttpContext context) =>
    {
        var id = context.Request.Query["id"];
        if (id.Count != 1)
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsync("missing user id");
            return;
        }
        var uri = serviceClient.GetClientAccessUri(userId: id).AbsoluteUri;
        await context.Response.WriteAsync(uri);
    });

    endpoints.MapWebPubSubHub<SampleChatHub>("/api/eventhandler/{*path}");
});

app.Run();

sealed class SampleChatHub : WebPubSubHub
{
    private readonly WebPubSubServiceClient<SampleChatHub> _serviceClient;

    public SampleChatHub(WebPubSubServiceClient<SampleChatHub> serviceClient)
    {
        _serviceClient = serviceClient;
    }

    public override async Task OnConnectedAsync(ConnectedEventRequest request)
    {
        await _serviceClient.SendToAllAsync($"[SYSTEM] {request.ConnectionContext.UserId} joined.");
    }

    public override async ValueTask<UserEventResponse> OnMessageReceivedAsync(UserEventRequest request, CancellationToken cancellationToken)
    {
        await _serviceClient.SendToAllAsync($"[{request.ConnectionContext.UserId}] {request.Data}");

        return request.CreateResponse($"[SYSTEM] ack.");
    }
}
